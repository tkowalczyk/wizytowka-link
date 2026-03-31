import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';
import { startRun, completeRun, failRun, type RunResult } from './lib/cron-log';

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      async fetch(request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);
        if (url.protocol === 'http:') {
          url.protocol = 'https:';
          return Response.redirect(url.toString(), 301);
        }
        // @ts-expect-error Astro vs CF workers Headers type mismatch
        return handle(manifest, app, request, env, ctx);
      },

      async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
        const runId = await startRun(env.leadgen, controller.cron);
        try {
          let result: RunResult;
          switch (controller.cron) {
            case '0 * * * *': {
              const { geocodeLocalities } = await import('./lib/geocoder');
              result = await geocodeLocalities(env);
              break;
            }
            case '0 8 * * *': {
              const { discoverBusinesses } = await import('./lib/discovery');
              const stats = await discoverBusinesses(env);
              result = {
                processed: stats.totalNewLeads,
                failed: 0,
                meta: {
                  apiCalls: stats.totalApiCalls,
                  businesses: stats.totalBusinesses,
                  quotaExhausted: stats.quotaExhausted,
                },
              };
              break;
            }
            case '*/5 * * * *': {
              const { generateSites } = await import('./lib/generate-sites');
              result = await generateSites(env);
              break;
            }
            default:
              result = { processed: 0, failed: 0 };
          }
          await completeRun(env.leadgen, runId, result);
        } catch (err) {
          await failRun(env.leadgen, runId, err);
          console.error(`[scheduled] ${controller.cron} error:`, err);
        }
      },
    } satisfies ExportedHandler<Env>,
  };
}
