import { handle } from "@astrojs/cloudflare/handler";
import { goneResponse, isLegacyLocalityPath } from "./lib/legacy-slug";
import { runScheduledCron } from "./lib/scheduled";

export default {
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
		return handle(request, env, ctx);
	},

	async scheduled(
		controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext,
	) {
		await runScheduledCron(env, controller.cron, ctx);
	},
} satisfies ExportedHandler<Env>;
