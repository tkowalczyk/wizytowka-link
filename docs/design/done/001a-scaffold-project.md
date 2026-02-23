# DD-001a: Scaffold — Project Init + Config + Stubs

## Przeglad

Czesc 1 z 2 scaffoldu (DD-001). Inicjalizacja Astro + CF Worker: konfiguracja, custom entry point z `scheduled` handlerem, stuby modulow. Schema D1 i typy biznesowe w [001b-scaffold-schema.md](./001b-scaffold-schema.md).

## Cele

- Dzialajacy projekt Astro z adapterem CF
- Custom worker entry point (`fetch` + `scheduled`)
- Dwa cron triggery: co godzine (geocoder), codziennie 8:00 (scraper+generator)
- Stuby: geocoder, scraper, generator, slug util
- Kompletna konfiguracja: wrangler, tsconfig, gitignore, env.d.ts

## Nie-cele

- D1 schema + migracje (DD-001b)
- Typy biznesowe w `src/types/` (DD-001b)
- Implementacja geocodera/scrapera (DD-002, DD-003)
- UI panelu sprzedawcy
- Deploy produkcyjny

---

## Architektura

```
                    Cloudflare Worker
                    +---------------------------------+
                    |  src/worker.ts (entry point)    |
  HTTP request ---->|  fetch() -> Astro SSR           |
                    |  scheduled() -> cron dispatch   |
                    +---------------------------------+
                           |          |          |
                          D1         R2       Secrets
                       (leadgen)  (sites)   (API keys)
```

Cron triggery:
- `0 * * * *` -- geocodeLocalities (Etap 3)
- `0 8 * * *` -- scrapeBusinesses + generateSites (Etap 4, 5)

---

## Implementacja

### 1. Inicjalizacja projektu

```bash
pnpm create astro@latest wizytowka-link -- --template minimal
cd wizytowka-link
pnpm astro add cloudflare
```

### 2. `package.json`

```json
{
  "name": "wizytowka-link",
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "wrangler dev",
    "types": "wrangler types",
    "db:migrate": "wrangler d1 execute leadgen --file=./migrations/0001-init.sql"
  },
  "dependencies": {
    "astro": "^5.x",
    "@astrojs/cloudflare": "^12.x",
    "@astrojs/tailwind": "^6.x",
    "tailwindcss": "^3.x"
  },
  "devDependencies": {
    "wrangler": "^4.x",
    "typescript": "^5.x",
    "@cloudflare/workers-types": "^4.x",
    "tsx": "^4.x"
  }
}
```

### 3. `astro.config.mjs`

```js
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'server',
  integrations: [tailwind()],
  adapter: cloudflare({
    workerEntryPoint: {
      path: 'src/worker.ts',
    },
  }),
});
```

### 4. `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "wizytowka-link",
  "main": "./dist/_worker.js/index.js",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],

  // D1
  "d1_databases": [
    {
      "binding": "leadgen",
      "database_name": "leadgen",
      "database_id": "<UTWORZ: pnpm wrangler d1 create leadgen>"
    }
  ],

  // R2
  "r2_buckets": [
    {
      "binding": "sites",
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

  // Astro SSR wymaga site asset servingu
  "assets": {
    "directory": "./dist/client/"
  }
}
```

Secrets w `.production.vars` (NIE w wrangler.jsonc, NIE w repo):
```
SERP_API_KEY=...
ZAI_API_KEY=...
TG_BOT_TOKEN=...
TG_WEBHOOK_SECRET=...
```

### 5. `src/worker.ts`

```ts
import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
      ) {
        return handle(manifest, app, request, env, ctx);
      },

      async scheduled(
        controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext
      ) {
        try {
          switch (controller.cron) {
            case '0 * * * *': {
              const { geocodeLocalities } = await import('./lib/geocoder');
              await geocodeLocalities(env);
              break;
            }
            case '0 8 * * *': {
              const { scrapeBusinesses } = await import('./lib/scraper');
              const { generateSites } = await import('./lib/generator');
              await scrapeBusinesses(env);
              await generateSites(env);
              break;
            }
          }
        } catch (err) {
          console.error(`[scheduled] ${controller.cron} error:`, err);
        }
      },
    } satisfies ExportedHandler<Env>,
  };
}
```

Dynamic import — geocoder/scraper/generator ladowane lazy, nie ewaluowane build time. `try/catch` jako safety net jesli modul nie istnieje.

### 6. `.gitignore`

```
node_modules/
dist/
.wrangler/
.production.vars
worker-configuration.d.ts
seed/.seed-state.json
seed/localities-batch-*.sql
.DS_Store
```

### 7. `tsconfig.json`

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types/2023-07-01"]
  }
}
```

### 8. `src/env.d.ts`

```ts
/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />
```

### 9. Generowanie typow

```bash
pnpm wrangler types
```

Wygeneruje `worker-configuration.d.ts` z interfejsem `Env` zawierajacym `leadgen: D1Database`, `sites: R2Bucket` + sekrety.

---

## Stub moduly

`src/lib/geocoder.ts`:
```ts
export async function geocodeLocalities(env: Env): Promise<void> {
  console.log('[geocoder] stub - not implemented');
}
```

`src/lib/scraper.ts`:
```ts
export async function scrapeBusinesses(env: Env): Promise<void> {
  console.log('[scraper] stub - not implemented');
}
```

`src/lib/generator.ts`:
```ts
export async function generateSites(env: Env): Promise<void> {
  console.log('[generator] stub - not implemented');
}
```

`src/lib/slug.ts`:
```ts
const POLISH_MAP: Record<string, string> = {
  'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
  'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
  'Ą': 'a', 'Ć': 'c', 'Ę': 'e', 'Ł': 'l', 'Ń': 'n',
  'Ó': 'o', 'Ś': 's', 'Ź': 'z', 'Ż': 'z',
};

export function slugify(input: string): string {
  return input
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => POLISH_MAP[ch] ?? ch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

---

## Struktura plikow (etap 001a)

```
wizytowka-link/
├── astro.config.mjs
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── .gitignore
├── src/
│   ├── worker.ts          # custom entry point
│   ├── env.d.ts
│   ├── lib/
│   │   ├── geocoder.ts    # (stub)
│   │   ├── scraper.ts     # (stub)
│   │   ├── generator.ts   # (stub)
│   │   └── slug.ts        # slugify util
│   └── pages/
│       └── index.astro
└── docs/
    └── design/
        ├── 001-scaffold-infrastructure.md
        ├── 001a-scaffold-project.md
        └── 001b-scaffold-schema.md
```

Brakujace w tym etapie (patrz DD-001b): `migrations/`, `src/types/`, `data/`.

---

## Weryfikacja

1. **Projekt buduje sie**
   ```bash
   pnpm install && pnpm run build
   ```

2. **Typy CF wygenerowane**
   ```bash
   pnpm run types
   # sprawdz: worker-configuration.d.ts istnieje z Env { leadgen, sites }
   ```

3. **Dev server startuje**
   ```bash
   pnpm wrangler dev
   # http://localhost:8787 zwraca strone
   ```

4. **Cron stuby dzialaja**
   ```bash
   pnpm wrangler dev --test-scheduled
   # w osobnym terminalu:
   curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
   # oczekiwany: 200 + log "[geocoder] stub"
   curl "http://localhost:8787/__scheduled?cron=0+8+*+*+*"
   # oczekiwany: 200 + log "[scraper] stub" + "[generator] stub"
   ```

---

## Decyzje

- **`database_id`** — `pnpm wrangler d1 create leadgen` z CLI, jednorazowo. ID wpisac recznie do `wrangler.jsonc`.
- **`compatibility_date`** — pin do `2025-04-01`. Aktualizowac swiadomie co kilka miesiecy.
- **R2 bucket** — jeden `sites`. MVP nie potrzebuje per-env.
- **`assets.directory`** — explicit `"assets": { "directory": "./dist/client/" }` jako override.
- **Stuby + dynamiczny import** — `import()` w `scheduled` ewaluuje sie runtime, nie build time. `try/catch` jako safety net.
- **`createExports` w `wrangler dev`** — obslugiwany. `workerEntryPoint` only works at build time (not `astro dev`), use `astro build && wrangler dev`.

## Action Items (resolved)

- [x] Verify Astro v5 + @astrojs/cloudflare v12 API: confirmed — `createExports`, `handle`, `workerEntryPoint.path` all exist in v12.6+.
- [x] Add `src/lib/generator.ts` stub.
- [x] Add missing files: `.gitignore`, `tsconfig.json`, `src/env.d.ts`.
- [x] Fix `ctx.waitUntil` — replaced with direct `await`.
- [x] Secrets: `.production.vars` in `.gitignore`.
- [x] `tsx` in devDependencies.

## Referencje

- [@astrojs/cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Astro on CF Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)
- [Scheduled handler API](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [Multiple Cron Triggers](https://developers.cloudflare.com/workers/examples/multiple-cron-triggers/)
- [wrangler.jsonc config](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [DD-001b: Schema + Types](./001b-scaffold-schema.md)
- [PLAN.md](../../PLAN.md)
