# Codebase Deepening Candidates

## 1. Scraper + Locality Matcher + Slug → "Business Discovery" module

- **Cluster**: `scraper.ts`, `scraper-api.ts`, `locality-matcher.ts`, `slug.ts`
- **Why coupled**: Scraper calls all three in tight loop per business. Locality matching duplicates D1 schema knowledge from scraper. Slug generation requires locality context from matcher.
- **Dependency category**: Internal + cross-boundary (SerpAPI, D1)
- **Test impact**: Currently untestable e2e. Unified module with injected deps enables testing scrape→match→slug pipeline without live APIs.
- **Status**: In progress

## 2. Generator + Editor + Themes → "Site Content" module

- **Cluster**: `generator.ts`, `editor.ts`, `themes.ts`, `types/site.ts`
- **Why coupled**: Generator calls GLM-5 + themes. Editor re-calls `callGLM5` + `validateSiteData` from generator. Theme baked into SiteData JSON at generation, making it immutable. Content and presentation fused.
- **Dependency category**: Internal + cross-boundary (GLM-5, R2)
- **Test impact**: `validateSiteData` and `themes.ts` testable today; rest requires live GLM-5/R2. Deepening isolates LLM calls behind boundary.
- **Design**: B (Flexible) — content/presentation split, R2 stays single-read fast path, D1 overrides survive re-gen
- **Issue**: #4
- **Status**: RFC created

## 3. Telegram Webhooks → "Telegram Gateway" module

- **Cluster**: `telegram.ts`, `api/telegram/client/[secret].ts`, `api/telegram/seller/[secret].ts`, `api/telegram/notify/[secret].ts`
- **Why coupled**: Three webhook endpoints duplicate secret validation, D1 lookups, error handling. Client webhook is 187 lines mixing message routing, draft management, R2 ops, GLM-5 calls. `telegram.ts` is thin HTTP wrapper while real logic lives in route handlers.
- **Dependency category**: Cross-boundary (Telegram API, D1, R2)
- **Test impact**: Route handlers untestable. Gateway with command dispatch enables testing business logic without Telegram mocks.
- **Design**: B (Flexible) — command-dispatch with TgHandler registry, future multi-channel path via command extraction
- **Issue**: #5
- **Status**: RFC created

## 4. Seller Panel Query + Lead API → "Lead Management" module

- **Cluster**: `s/[token].astro`, `api/leads/[id].ts`, `api/contact.ts`
- **Why coupled**: Seller panel builds massive dynamic SQL for lead listing. Lead API mutates call_log with same schema assumptions. Contact endpoint creates leads and notifies sellers. All three encode D1 schema knowledge and phone normalization rules.
- **Dependency category**: Internal (D1 schema)
- **Test impact**: Complex SQL in Astro page completely untestable. Query layer enables testing filter combos and pagination.
- **Design**: A+C hybrid — `Leads` class with D1 injection, `phone.ts` standalone, `db.batch()` for rows+count
- **Issue**: #6
- **Status**: RFC created

## 5. Cron Orchestration + Pipeline State

- **Cluster**: `worker.ts`, `geocoder.ts`, `scraper.ts`, `generator.ts`
- **Why coupled**: worker.ts directly calls each cron handler. No state tracking between runs — pipeline progress implicit in DB flags.
- **Dependency category**: Internal (D1 state flags)
- **Test impact**: Zero coverage on orchestration.
- **Design**: Lightweight — architecture is already correct (independent jobs, D1 flag coordination). Not a module consolidation.
- **Improvements**: CronLog table (run history), RunResult return type (structured reporting), geocoder retry-after (resilience)
- **Issue**: #7
- **Status**: RFC created
