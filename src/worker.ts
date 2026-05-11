import { handle } from "@astrojs/cloudflare/handler";
import type { SSRManifest } from "astro";
import { App } from "astro/app";
import { goneResponse, isLegacyLocalityPath } from "./lib/legacy-slug";
import { runScheduledCron } from "./lib/scheduled";

export function createExports(manifest: SSRManifest) {
	const app = new App(manifest);
	return {
		default: {
			async fetch(request, env: Env, ctx: ExecutionContext) {
				const url = new URL(request.url);
				if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
					url.pathname = url.pathname.replace(/\/+$/, "");
					return new Response(null, {
						status: 301,
						headers: { Location: url.toString() },
					});
				}
				if (await isLegacyLocalityPath(env.leadgen, url.pathname)) {
					return goneResponse();
				}
				// @ts-expect-error Astro vs CF workers Headers type mismatch
				return handle(manifest, app, request, env, ctx);
			},

			async scheduled(
				controller: ScheduledController,
				env: Env,
				ctx: ExecutionContext,
			) {
				await runScheduledCron(env, controller.cron, ctx);
			},
		} satisfies ExportedHandler<Env>,
	};
}
