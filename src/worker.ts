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
