import { handle } from "@astrojs/cloudflare/handler";
import type { SSRManifest } from "astro";
import { App } from "astro/app";
import { runScheduledCron } from "./lib/scheduled";

export function createExports(manifest: SSRManifest) {
	const app = new App(manifest);
	return {
		default: {
			async fetch(request, env: Env, ctx: ExecutionContext) {
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
