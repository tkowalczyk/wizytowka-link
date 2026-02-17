import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      async fetch(request, env: Env, ctx: ExecutionContext) {
        // @ts-expect-error Astro vs CF workers Headers type mismatch
        return handle(manifest, app, request, env, ctx);
      },

      async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
        try {
          switch (controller.cron) {
            case '0 * * * *': {
              const { geocodeLocalities } = await import('./lib/geocoder');
              await geocodeLocalities(env);
              break;
            }
            case '0 8 * * *': {
              const { scrapeBusinesses } = await import('./lib/scraper');
              await scrapeBusinesses(env);
              break;
            }
            case '*/5 * * * *': {
              const { generateSites } = await import('./lib/generator');
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
