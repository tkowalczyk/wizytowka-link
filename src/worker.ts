import { handle } from "@astrojs/cloudflare/handler";
import { goneResponse, isLegacyLocalityPath } from "./lib/legacy-slug";
import {
	type PublicPageVisitInput,
	recordPublicPageVisit,
} from "./lib/public-page";
import { runScheduledCron } from "./lib/scheduled";

function publicPageVisitInput(
	request: Request,
	url: URL,
): PublicPageVisitInput | null {
	if (request.method !== "GET") return null;
	if (
		url.searchParams.get("draft") === "1" ||
		url.searchParams.has("preview_token")
	) {
		return null;
	}

	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length !== 2) return null;
	return { locSlug: segments[0], businessSlug: segments[1] };
}

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
		const visitInput = publicPageVisitInput(request, url);
		const response = await handle(request, env, ctx);
		if (visitInput && response.ok) {
			// Count each successful public page GET as the denominator for chat-start rate.
			ctx.waitUntil(
				recordPublicPageVisit(env.leadgen, visitInput, {
					referrer: request.headers.get("Referer"),
					userAgent: request.headers.get("User-Agent"),
				}).catch((error) => {
					console.error("page visit analytics failed:", error);
				}),
			);
		}
		return response;
	},

	async scheduled(
		controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext,
	) {
		await runScheduledCron(env, controller.cron, ctx);
	},
} satisfies ExportedHandler<Env>;
