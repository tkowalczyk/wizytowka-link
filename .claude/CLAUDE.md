# wizytowka-link

Lead-gen platform: scrapes Polish businesses via SerpAPI, generates static "wizytówka" (business card) sites on Cloudflare, surfaces leads to sellers via panel + Telegram.

## Tooling

- **Runtime**: Cloudflare Workers — D1 (`leadgen`), R2 (`sites`), KV (`STATE`), Cron triggers
- **Framework**: Astro 5 SSR with `@astrojs/cloudflare` adapter; entry in `src/worker.ts`
- **Styling**: TailwindCSS 4 via `@tailwindcss/vite`, `@theme inline` tokens in `src/styles/base.css` (no tailwind.config)
- **Lint/format**: Biome (not ESLint/Prettier) — `biome.json`
- **Tests**: Vitest + `@cloudflare/vitest-pool-workers` (real D1/R2 via Miniflare), co-located `foo.test.ts` next to `foo.ts`

## Project structure

```
src/
  worker.ts                      # CF Worker entry — delegates scheduled() to lib/scheduled.ts
  pages/
    [loc]/[slug].astro           # Public business page
    s/                           # Seller panel (token-authed)
    api/
      admin/run-cron/[name].ts   # Manual cron trigger (x-admin-token)
      contact.ts                 # Public contact form
      cron-log.ts                # Seller-authed run history
      health/serpapi.ts          # SerpAPI quota probe
      leads/[id].ts              # Update lead status
      telegram/{seller,notify,client}/[secret].ts  # Webhooks for 3 bots
  lib/
    scheduled.ts                 # Single source of truth: CRON_PATTERNS + runScheduledCron
    cron-log.ts                  # startRun/completeRun/failRun + RunResult + getCronSummary
    geocoder.ts                  # Nominatim geocoding with exponential backoff
    discovery/
      index.ts                   # discoverBusinesses + daily report wiring
      preflight.ts               # SerpAPI quota check + KV skip-flag
      ports.ts                   # SearchPort, NotifyPort, DiscoveryDeps
    serpapi/                     # SerpAPI client + types
    generate-sites.ts            # Site JSON generator (Z.ai GLM-5 → R2)
    site-content.ts              # LLM provider (Z.ai GLM-5)
    site-store.ts                # R2 CRUD for site JSON (live/draft)
    presentation.ts              # Theme resolution with per-business overrides
    themes.ts                    # 8 OKLCH palettes + style/layout variants
    category.ts                  # Category → palette mapping
    leads.ts                     # Seller auth, status logging, queries
    telegram.ts                  # Telegram API client + daily report
    telegram/                    # Dispatch pattern — handlers for 3 bots
    locality-slug.ts             # TERYT sym-fallback locality slugs
    locality-label.ts            # Locality display labels
    structured-data.ts           # JSON-LD for business pages
    slug.ts                      # Polish char normalization
    phone.ts                     # Polish phone normalization
    token.ts                     # Token generation
  components/
    BusinessSite.astro           # Main biz page wrapper (theme + CSS vars injection)
    layouts/                     # 3 layout variants: centered, split, minimal
  styles/base.css                # Tailwind import + @theme inline tokens
  types/                         # business.ts, site.ts, serpapi.ts
migrations/                      # D1 SQL migrations
test/seed.ts                     # Schema + seed data for integration tests
docs/design/                     # Numbered design docs (read before implementing features)
```

<important if="you need to run non-trivial commands (standard dev/build/test are in package.json)">
```bash
pnpm seed                          # WIPES local D1+R2, re-migrates, re-seeds
pnpm db:migrate:remote             # Apply D1 migrations to production
curl http://localhost:8787/cdn-cgi/handler/scheduled  # Trigger crons locally (requires pnpm preview, NOT pnpm dev)
```

Manually trigger a single cron on production (after `wrangler secret put ADMIN_TOKEN`):

```bash
curl -X POST https://wizytowka.link/api/admin/run-cron/{name} \
  -H "Origin: https://wizytowka.link" \
  -H "x-admin-token: $ADMIN_TOKEN"
```

Where `{name}` is one of: `geocoder`, `preflight`, `discovery`, `generate`. Astro 5 CSRF (`security.checkOrigin`) requires the `Origin` header to match the production domain — without it Astro returns "Cross-site POST form submissions are forbidden".
</important>

<important if="you are adding, modifying, or debugging a cron handler">
Cron → handler mapping lives in `src/lib/scheduled.ts` (`CRON_PATTERNS` + `runScheduledCron`). `src/worker.ts` scheduled() just delegates. Adding a new cron requires changes in both `scheduled.ts` (new entry in `CRON_PATTERNS` + case in `executeCron`) AND `wrangler.jsonc` (`triggers.crons`).

Current pipeline:

- `0 * * * *` — **geocoder**: Nominatim on next ungeocoded TERYT locality
- `55 7 * * *` — **preflight**: SerpAPI quota probe; sets KV skip-flag if below `DISCOVERY_MIN_QUOTA`
- `0 8 * * *` — **discovery**: SerpAPI scrape; respects preflight skip-flag; writes to `businesses`
- `*/5 * * * *` — **generate**: unfilled `businesses` → Z.ai GLM-5 → R2 site JSON

Every run is logged to `cron_log` via `startRun`/`completeRun`/`failRun`. All handlers must return `RunResult { processed, failed, meta? }`.
</important>

<important if="you are writing or modifying a D1 query">
- D1 binds **max 100 params per statement**. Batch inserts must chunk accordingly (e.g. 8 rows × 12 cols = 96 params). Check column count when tuning.
- Use `INSERT OR IGNORE` for idempotency, `datetime('now')` for timestamps.
- Partial indexes are used for cron queries (e.g. `WHERE searched_at IS NULL`).

Schema tables: `localities` (~95k TERYT records), `businesses`, `sellers`, `call_log` (append-only), `business_owners`, `cron_log`, `alert_log`.
</important>

<important if="you are touching discovery, preflight, or geocoder code">
- **Port-based DI**: discovery accepts `SearchPort` + `NotifyPort` via `DiscoveryDeps`; geocoder accepts `GeocoderDeps`. Tests use real D1/R2 but mock these ports.
- **Wall-time guards**: geocoder 12min; discovery respects SerpAPI quota limits.
- **Preflight skip**: discovery checks KV `SKIP_FLAG_KEY` and bails before burning any call if preflight flagged low quota.
- **Geocoder retry**: exponential backoff via `geocode_retry_after` column (1h → 2h → ... → 7d). `geocode_failed=1` is reserved for manual skip, never set on automatic failures.
- **TERYT sym fallback**: ~3% of localities need a sym suffix in the slug (not rare — handle both cases in queries and slug generation).
</important>

<important if="you are editing theme, layout, or presentation code">
Theme system: 8 OKLCH palettes × light/dark × 3 style variants (`modern`/`elegant`/`bold`) × 3 layout variants (`centered`/`split`/`minimal`). Selection is deterministic from slug hash (same business = same look always). CSS vars injected per-page via `<style set:html>`, referenced by Tailwind semantic tokens.

Files: `src/lib/themes.ts` (palettes), `src/lib/category.ts` (category → palette), `src/lib/presentation.ts` (per-business overrides), `src/styles/base.css` (`[data-style]` rules), `src/components/layouts/` (3 Astro layout components).
</important>

<important if="you are calling or integrating an external API">
- **Nominatim** (OSM): 1 req/sec rate limit, no API key
- **SerpAPI**: `SERP_API_KEY`. Quota-sensitive — respect preflight skip-flag
- **Z.ai GLM-5** (NOT Cloudflare Workers AI): `ZAI_API_KEY`, endpoint `https://api.z.ai/api/coding/paas/v4/chat/completions`, model `glm-5`. Used in `src/lib/site-content.ts`
- **Telegram Bot API**: 3 separate bots — `TG_SELLER_BOT_TOKEN` (reports + registration), `TG_NOTIFY_BOT_TOKEN` (new lead alerts), `TG_CLIENT_BOT_TOKEN` (business owner edits + draft approval). Webhooks at `/api/telegram/{bot}/[secret]`
</important>

<important if="you are handling authentication or secrets">
- **Seller auth**: token-based — URL path `/s/{token}` or `x-seller-token` header. Logic in `src/lib/leads.ts` (`Leads.authenticate`, `Leads.extractToken`).
- **Admin auth**: single `ADMIN_TOKEN` secret, `x-admin-token` header — only for `/api/admin/run-cron/{name}`. Fail-closed (500 if secret not set).
- **Secrets files**: `.dev.vars` / `.production.vars` are gitignored — never commit. Production secrets via `wrangler secret put`.
</important>

<important if="you are implementing a new feature">
Read relevant design docs in `docs/design/` first — numbered sequentially (e.g. `012a-category-logos.md`), contain rationale and scope. Completed specs archived in `docs/design/done/`.
</important>

<important if="you are generating a slug for a business or locality">
Polish char normalization required (ą→a, ł→l, ś→s, ż→z, ź→z, ć→c, ń→n, ó→o, ę→e). Collision suffix: `-{sym}` for locality slugs (TERYT SIMC code), `-2`, `-3`... for business slugs. See `src/lib/slug.ts`, `src/lib/locality-slug.ts`.
</important>
