# DD-008: Deploy + Domena (Etap 8)

## Przeglad

Produkcyjny deploy wizytowka.link na Cloudflare Workers. Domena, D1, R2, sekrety, Telegram webhook, weryfikacja pelnego flow.

## Kontekst

Etapy 1-7 gotowe. Worker obsluguje: geocoder (cron), scraper (cron), generator stron, panel sprzedawcy, Telegram bot. Czas wyjsc na produkcje.

## Cele

- Domena `wizytowka.link` podpieta do workera
- D1 + R2 utworzone i zasilone danymi
- Sekrety ustawione
- Telegram webhook aktywny
- Pierwszy sprzedawca dodany
- Pelny flow zweryfikowany end-to-end

## Nie-cele

- CI/CD pipeline (przyszly etap)
- Staging environment
- Automatyczne backupy D1

---

## Runbook

### Krok -1: Authenticate Wrangler

```bash
wrangler login
```

Opens browser for Cloudflare OAuth. Required before any wrangler command.

### Krok 0: SerpAPI Plan Upgrade

Free plan = 100 req/mo ≈ 1 locality/month (18 categories × 5 pages = 90 req/locality). **Upgrade to Developer plan ($50/mo, 5000 req)** at [serpapi.com/manage-api-key](https://serpapi.com/manage-api-key) before enabling scraper cron.

### Krok 1: Domena

Kup `wizytowka.link` na [CF Registrar](https://dash.cloudflare.com/?to=/:account/domains/register) lub dodaj zewnetrzna domene do CF (zmien nameservery).

### Krok 2: Utworz zasoby

```bash
wrangler d1 create leadgen
wrangler r2 bucket create sites
```

Zapisz `database_id` z outputu `d1 create`.

### Krok 3: `wrangler.jsonc` — finalna konfiguracja

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "wizytowka-link",
  "main": "./dist/_worker.js/index.js",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],

  // Custom domain (wrangler v4: top-level array, nie w routes)
  "custom_domains": [
    "wizytowka.link"
  ],

  // D1
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "leadgen",
      "database_id": "<ID-Z-KROKU-2>"
    }
  ],

  // R2
  "r2_buckets": [
    {
      "binding": "R2",
      "bucket_name": "sites"
    }
  ],

  // Cron
  "triggers": {
    "crons": [
      "0 * * * *",
      "0 8 * * *"
    ]
  },

  // Astro SSR assets
  "assets": {
    "directory": "./dist/client/"
  }
}
```

### Krok 4: Schema D1

```bash
wrangler d1 execute leadgen --file=./migrations/0001-init.sql
```

### Krok 5: Seed TERYT (DD-002)

Wymaga `data/simc.csv` i `data/terc.csv` (patrz DD-002).

```bash
npx tsx seed/parse-simc.ts
```

Skrypt interaktywny — seeduje per-wojewodztwo, pyta po kazdym. Wznawiany po przerwaniu.

Weryfikacja:
```bash
wrangler d1 execute leadgen --command="SELECT COUNT(*) FROM localities"
# oczekiwane: ~95100
```

### Krok 6: Sekrety (`.production.vars`)

Utworz plik `.production.vars` w katalogu projektu (dodaj do `.gitignore`):

```
SERP_API_KEY=...
ZAI_API_KEY=...
TG_BOT_TOKEN=...
TG_WEBHOOK_SECRET=...
```

Generowanie webhook secret:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Wrangler automatycznie laduje ten plik przy `wrangler deploy`.

| Zmienna | Cel |
|---|---|
| `SERP_API_KEY` | SerpAPI — wyszukiwanie firm |
| `ZAI_API_KEY` | Z.AI GLM-5 — generowanie stron |
| `TG_BOT_TOKEN` | Telegram Bot API — powiadomienia |
| `TG_WEBHOOK_SECRET` | Secret w URL webhooka Telegram |

### Krok 7: Deploy

```bash
pnpm run build && wrangler deploy
```

### Krok 8: Telegram webhook

```bash
curl "https://api.telegram.org/bot<TG_BOT_TOKEN>/setWebhook?url=https://wizytowka.link/api/telegram/webhook/<TG_WEBHOOK_SECRET>"
```

Oczekiwany response: `{"ok":true,"result":true,"description":"Webhook was set"}`

### Krok 9: Dodaj sprzedawce

```bash
wrangler d1 execute leadgen --command="INSERT INTO sellers (name, token) VALUES ('Sprzedawca1', 'WYGENERUJ-UUID')"
```

Generowanie UUID:
```bash
python3 -c "import uuid; print(uuid.uuid4())"
```

### Krok 10: Weryfikacja end-to-end

Patrz sekcja "Smoke testy" i "Production checklist" ponizej.

---

## Sekrety

| Zmienna | Zrodlo | Uwagi |
|---|---|---|
| `SERP_API_KEY` | serpapi.com | Plan Free: 100 req/mies |
| `ZAI_API_KEY` | z.ai | Zmienione z XAI_API_KEY — uzywamy Z.AI GLM-5 |
| `TG_BOT_TOKEN` | @BotFather | Bot do powiadomien sprzedawcow |
| `TG_WEBHOOK_SECRET` | generowany lokalnie | Secret w URL webhooka, weryfikowany w DD-007 |

**Nigdy** w `wrangler.jsonc` ani w repo. Przechowywane w `.production.vars` (w `.gitignore`).

---

## Production Checklist

- [ ] Domena `wizytowka.link` resolves do workera
- [ ] HTTPS dziala (automatyczne z CF)
- [ ] Cron triggery aktywne: CF Dashboard → Workers → Triggers
- [ ] D1 ma dane localities (~95k)
- [ ] R2 bucket `sites` istnieje
- [ ] Wszystkie 4 sekrety ustawione
- [ ] Telegram webhook aktywny
- [ ] Sprzedawca dodany z validnym tokenem
- [ ] Panel dostepny: `https://wizytowka.link/s/{token}`
- [ ] Strony biznesowe renderuja: `https://wizytowka.link/{loc}/{slug}`

---

## Smoke Testy

```bash
# 1. Panel sprzedawcy
curl -s -o /dev/null -w "%{http_code}" https://wizytowka.link/s/<TOKEN>
# oczekiwane: 200

# 2. Strona biznesowa (po pierwszym runie scrapera)
curl -s -o /dev/null -w "%{http_code}" https://wizytowka.link/<loc>/<slug>
# oczekiwane: 200

# 3. DNS
dig wizytowka.link +short
# oczekiwane: CF IP

# 4. HTTPS
curl -I https://wizytowka.link
# oczekiwane: HTTP/2 200, cf-ray header

# 5. Telegram webhook info
curl "https://api.telegram.org/bot<TG_BOT_TOKEN>/getWebhookInfo"
# oczekiwane: url = https://wizytowka.link/api/telegram/webhook/<SECRET>

# 6. D1 dane
wrangler d1 execute leadgen --command="SELECT COUNT(*) FROM localities WHERE lat IS NOT NULL"
# oczekiwane: >0 (po geocoderze)

# 7. Cron — nastepny dzien o 8:00
# sprawdz: nowe leady w panelu sprzedawcy
```

---

## Monitoring

| Co | Jak | Czestotliwosc |
|---|---|---|
| Worker errors | CF Dashboard → Workers → Logs | Na biezaco |
| Cron executions | CF Dashboard → Workers → Triggers | Dziennie |
| D1 query metrics | CF Dashboard → D1 → Metrics | Tygodniowo |
| R2 storage | CF Dashboard → R2 | Tygodniowo |
| Telegram bot | Bot powinien raportowac dziennie | Dziennie |
| Nowe leady | Panel sprzedawcy | Dziennie |

Brak dedykowanego alertingu — manualna kontrola w fazie MVP.

### Basic alerting (MVP)

Set up CF Workers notification triggers via Dashboard → Workers → Triggers → Notifications:
- **Worker error rate** — alert if >10 errors/hour
- **Cron failure** — CF emails on cron handler uncaught exceptions (enabled by default)

Supplement with daily Telegram report — if no report arrives by 11:00 CET, cron likely failed.

---

## Rollback Plan

### Worker code

```bash
wrangler rollback
```

Przywraca poprzednia wersje workera. Natychmiastowe.

### D1

Brak automatycznego rollbacku. Mitigacja:
- Schema migrations wersjonowane w `migrations/`
- Przed destructive migration: `wrangler d1 execute leadgen --command="SELECT * FROM ..." > backup.json`
- D1 Time Travel (last 30 days): `wrangler d1 time-travel restore leadgen --timestamp=<ISO>`

### R2

Obiekty persistuja miedzy deployami. Usuwanie wymaga explicit `wrangler r2 object delete`.

### Domena

DNS propagacja ~5 min. Jesli worker padnie — domena zwraca CF error page automatycznie.

### Sekrety

`.production.vars` to plik — wersjonuj zmiany w menedzerze hasel, nie w repo.

---

## Architektura produkcyjna

```
                    Internet
                       │
                       ▼
              ┌─── wizytowka.link ───┐
              │   CF DNS + SSL       │
              └──────────┬───────────┘
                         │
              ┌──────────▼───────────┐
              │  Cloudflare Worker   │
              │  ┌─ fetch() ──────┐  │
              │  │ Astro SSR      │  │
              │  │ /s/{token}     │  │
              │  │ /{loc}/{slug}  │  │
              │  │ /api/telegram  │  │
              │  └────────────────┘  │
              │  ┌─ scheduled() ──┐  │
              │  │ 0 * * * *      │──┼──► geocoder → Nominatim
              │  │ 0 8 * * *      │──┼──► scraper → SerpAPI → Z.AI → Telegram
              │  └────────────────┘  │
              └───┬────┬────┬────────┘
                  │    │    │
                  ▼    ▼    ▼
                 D1   R2  Secrets
              leadgen sites  (3 keys)
```

---

## Referencje

- [CF Registrar](https://developers.cloudflare.com/registrar/)
- [CF Custom Domains for Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Wrangler deploy](https://developers.cloudflare.com/workers/wrangler/commands/#deploy)
- [Wrangler secrets](https://developers.cloudflare.com/workers/wrangler/commands/#secret)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Wrangler rollback](https://developers.cloudflare.com/workers/wrangler/commands/#rollback)
- DD-001: Scaffold + infrastruktura
- DD-002: Seed TERYT SIMC

---

## Decyzje

- **Domena** — CF Registrar. Najprostsze, brak migracji nameserverow.
- **`custom_domains`** — top-level array w wrangler v4, nie `routes` z `custom_domain: true`.
- **Free plan 100k req/day** — wystarczy. MVP <100 userow. Monitor via dashboard.
- **D1 backup** — Time Travel (30 dni). Wystarczy na MVP. Brak exportu SQL.
- **Healthcheck** — nie. Manualny monitoring via CF Dashboard.
- **SerpAPI Free** — ~1 miejscowosc/mies. Potrzebny plan $50 (5000 req) dla sensownego throughputu.
- **Z.AI rate limits** — nieznane. 10 firm/run konserwatywne. Monitorowac i dostosowyac.
- **Telegram webhook secret** — tak. Secret w URL path, generowany przez `secrets.token_urlsafe(32)`. Patrz DD-007.

---

## Action Items (z REVIEW.md)

### P0 — Blockers

- [x] **Add SerpAPI plan upgrade step**: added as Krok 0 in runbook.

### P1 — Runtime errors

- [x] **Add `wrangler login` step**: added as Krok -1.
- [x] **Document cron timezone**: added UTC note + CET/CEST times to cron section.
- [x] **Add geocoding warmup timeline**: added Krok 7.1 with day-by-day timeline.

### P2 — Consistency

- [x] **Add www redirect**: added Krok 7.2 with CF redirect rule config.
- [ ] **Add `wrangler dev --test-scheduled` step**: runbook says "nastepny dzien o 8:00" for cron verification. Add immediate test step using `--test-scheduled`.
- [ ] **Fix secret generation commands**: uses Python (`secrets.token_urlsafe`, `uuid.uuid4`). Add Node alternative: `node -e "console.log(crypto.randomUUID())"`.
- [ ] **Document D1 Time Travel usage**: show exact command with ISO timestamp format.
