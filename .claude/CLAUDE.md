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
  worker.ts          # CF Worker entry: fetch() + scheduled()
  pages/             # Astro routes ([loc]/[slug].astro, /s/{token}, /api/*)
  lib/
    geocoder.ts      # Nominatim geocoding (hourly cron)
    scraper.ts       # SerpAPI business scraper (daily cron)
    scraper-api.ts   # SerpAPI client + pagination
    generator.ts     # Site JSON generator (Workers AI → R2)
    telegram.ts      # Telegram bot client + daily report
    themes.ts        # OKLCH palettes, style/layout variants, category→palette mapping
    slug.ts          # Polish-aware slug util
  types/
    business.ts      # LocalityRow, BusinessRow, BusinessInsert, SellerRow, CallLogRow
    site.ts          # SiteData (generated content + theme)
    serpapi.ts       # SerpAPI response types
  styles/
    base.css         # Tailwind import, @theme inline tokens, style-variant rules
  components/
    BusinessSite.astro  # Main biz page wrapper (theme resolution + CSS vars injection)
    layouts/         # 3 layout variants: centered, split, minimal
migrations/          # D1 SQL migrations (0001–0005)
scripts/             # TERYT CSV parsers + seed runners
data/                # SIMC/TERC CSVs + generated SQL batches
docs/design/         # Numbered design docs (001–009)
```

## Key commands

```bash
pnpm dev              # Astro dev server
pnpm build            # Build SSR to dist/
pnpm preview          # wrangler dev (local CF emulation)
pnpm deploy           # wrangler deploy
pnpm db:migrate       # Run D1 migrations (local)
pnpm seed             # Wipe local D1+R2, migrate, seed test data
# Cron trigger (local dev):
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

## Architecture

- **Cron-driven pipeline**: geocoder (hourly, `0 * * * *`) → scraper (daily, `0 8 * * *`) → generator (every 5min, `*/5 * * * *`)
- **D1 schema**: `localities` (~95k Polish TERYT records), `businesses`, `sellers`, `call_log` (append-only)
- **R2 keys**: `sites/{locality_slug}/{business_slug}.json`
- **Seller auth**: token-based (URL path `/s/{token}` or API header)
- **Wall-time guards**: geocoder 25min, scraper respects quota limits
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

## External APIs

- **Nominatim** (OSM): 1 req/sec rate limit, no API key
- **SerpAPI**: key in `.dev.vars` / `.production.vars` as `SERP_API_KEY`
- **Telegram Bot API**: `TELEGRAM_BOT_TOKEN` + webhook at `/api/telegram/{secret}`
- **Workers AI**: GLM-5 for site content generation
