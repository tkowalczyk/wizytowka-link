# wizytowka-link

Lead-gen platform: scrapes Polish businesses via SerpAPI, generates static "wizytówka" (business card) sites on Cloudflare, surfaces leads to sellers via panel + Telegram.

## Stack

- **Runtime**: Cloudflare Workers (D1 + R2 + Cron triggers)
- **Framework**: Astro 5 SSR (`@astrojs/cloudflare` adapter)
- **Language**: TypeScript strict
- **Styling**: TailwindCSS 4 (`@tailwindcss/vite` plugin, `@theme inline` in base.css, no config file)
- **Package manager**: pnpm
- **Deploy**: `wrangler deploy`
- **Dev**: `astro dev` (local), `wrangler dev` (CF emulation)

## Project structure

```
src/
  worker.ts            # CF Worker entry: fetch() + scheduled() with cron-log
  pages/               # Astro routes ([loc]/[slug].astro, /s/{token}, /api/*)
    api/
      cron-log.ts      # GET /api/cron-log — seller-authenticated run history
      leads/[id].ts    # PUT /api/leads/:id — update lead status
      contact.ts       # POST /api/contact — public contact form
      telegram/        # Webhook endpoints for 3 bots (seller/client/notify)
  lib/
    cron-log.ts        # RunResult type, startRun/completeRun/failRun + getCronSummary
    geocoder.ts        # Nominatim geocoding with retry backoff (hourly cron)
    discovery/         # SerpAPI business discovery with port-based DI (daily cron)
      index.ts         # discoverBusinesses + Telegram report wiring
      ports.ts         # SearchPort, NotifyPort, DiscoveryDeps, DiscoveryStats
    generate-sites.ts  # Site JSON generator (Workers AI → R2, every 5min)
    site-content.ts    # LLM provider + content generation
    site-store.ts      # R2 CRUD for site JSON (live/draft)
    presentation.ts    # Theme resolution with per-business overrides
    leads.ts           # Leads class — seller auth, status logging, queries
    phone.ts           # Polish phone normalization
    telegram.ts        # Telegram API client + daily report + cron stats formatting
    telegram/          # Dispatch pattern — handlers for 3 bots
      dispatch.ts      # Webhook → handler routing
      types.ts         # TgHandler, BotConfig, TgContext
      queries.ts       # D1 queries for telegram state
      handlers/        # registration.ts, client.ts
    themes.ts          # OKLCH palettes, style/layout variants, category→palette mapping
    slug.ts            # Polish-aware slug util
    token.ts           # Token generation
  types/
    business.ts        # LocalityRow, BusinessRow, BusinessInsert, SellerRow, CallLogRow
    site.ts            # SiteData (generated content + theme)
    serpapi.ts         # SerpAPI response types
  styles/
    base.css           # Tailwind import, @theme inline tokens, style-variant rules
  components/
    BusinessSite.astro # Main biz page wrapper (theme resolution + CSS vars injection)
    layouts/           # 3 layout variants: centered, split, minimal
migrations/            # D1 SQL migrations (0001–0008)
test/
  seed.ts              # Schema + seed data for integration tests
scripts/               # TERYT CSV parsers + seed runners
data/                  # SIMC/TERC CSVs + generated SQL batches
docs/design/           # Numbered design docs (001–009)
```

## Key commands

```bash
pnpm dev              # Astro dev server
pnpm build            # Build SSR to dist/
pnpm preview          # wrangler dev (local CF emulation)
npx wrangler deploy   # Deploy to Cloudflare
pnpm db:migrate:remote # Run D1 migrations (production)
pnpm seed             # Wipe local D1+R2, migrate, seed test data
pnpm test             # Run all tests (150+)
pnpm test:watch       # Watch mode
# Cron trigger (local dev):
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

## Architecture

- **Cron-driven pipeline**: geocoder (hourly, `0 * * * *`) → discovery (daily, `0 8 * * *`) → generator (every 5min, `*/5 * * * *`)
- **Cron observability**: every run logged to `cron_log` table via `startRun`/`completeRun`/`failRun`. All handlers return `RunResult { processed, failed, meta? }`
- **D1 schema**: `localities` (~95k Polish TERYT records), `businesses`, `sellers`, `call_log` (append-only), `business_owners`, `cron_log`
- **R2 keys**: `sites/{locality_slug}/{business_slug}.json` (live), `sites/draft/...` (draft)
- **Seller auth**: token-based (URL path `/s/{token}` or `x-seller-token` header)
- **Telegram**: 3 separate bots — seller (reports + registration), notify (new lead alerts), client (business owner edits + draft approval)
- **Port-based DI**: discovery and geocoder accept deps for testability (SearchPort, NotifyPort, GeocoderDeps)
- **Geocoder retry**: exponential backoff via `geocode_retry_after` column (1h→2h→...→7d max). `geocode_failed=1` reserved for manual skip
- **Wall-time guards**: geocoder 12min, discovery respects quota limits
- **Batch inserts**: max 8 rows per INSERT (D1 100-param limit)

## Conventions

- Design docs in `docs/design/` — numbered sequentially (001a, 001b, 002a…). Read relevant docs before implementing a feature
- Slugs: Polish char normalization (ą→a, ł→l…), collision suffix (`-{sym}` or `-2`)
- DB: `INSERT OR IGNORE` for idempotency, partial indexes for cron queries, `datetime('now')` for timestamps
- Migrations: sequential numbered SQL files in `migrations/`
- Env secrets: `.dev.vars` / `.production.vars` (gitignored) — never commit

## Theme system

- 8 OKLCH palettes (`ocean`, `forest`, `sunset`, `royal`, `crimson`, `slate`, `teal`, `earth`) with light+dark variants
- Palettes mapped to categories (warm→food, clinical→medical, industrial→trades)
- 3 style variants (`modern`, `elegant`, `bold`) — applied via `[data-style]` in base.css
- 3 layout variants (`centered`, `split`, `minimal`) — separate Astro components
- Selection: deterministic hash from slug (same business = same look always)
- CSS vars injected per-page via `<style set:html>`, referenced by Tailwind semantic tokens

## D1 param limit

D1 binds max 100 params per statement. Batch inserts must chunk accordingly (e.g. 8 rows × 12 cols = 96 params).

## Testing

- **Framework**: Vitest + `@cloudflare/vitest-pool-workers` (real D1/R2 in tests)
- **Co-located**: `foo.test.ts` next to `foo.ts`
- **Seed**: `test/seed.ts` — schema (0001–0008) + minimal dataset (4 localities, 6 businesses, 2 sellers)
- **Pattern**: port-based DI for external APIs (SearchPort, GeocoderDeps), real D1 for everything else
- **Coverage**: 150+ tests across 16 files

## External APIs

- **Nominatim** (OSM): 1 req/sec rate limit, no API key
- **SerpAPI**: key in `.dev.vars` / `.production.vars` as `SERP_API_KEY`
- **Telegram Bot API**: 3 bots — `TG_SELLER_BOT_TOKEN`, `TG_NOTIFY_BOT_TOKEN`, `TG_CLIENT_BOT_TOKEN` + webhooks at `/api/telegram/{bot}/[secret]`
- **Workers AI**: GLM-5 for site content generation (key: `ZAI_API_KEY`)
