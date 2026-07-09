import { handle } from "@astrojs/cloudflare/handler";
import { goneResponse } from "./lib/legacy-slug";
import {
	type PublicPageVisitInput,
	recordPublicPageVisit,
} from "./lib/public-page";
import { runScheduledCron } from "./lib/scheduled";
import { resolveStaleLocalityUrl } from "./lib/slug-redirect";

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
		// Stale locality slugs (mutable across the Phase 2 migration) 301 to their
		// canonical URL; genuinely-dead legacy URLs 410. See slug-redirect.
		const staleResolution = await resolveStaleLocalityUrl(
			env.leadgen,
			url.pathname,
		);
		if (staleResolution.kind === "redirect") {
			url.pathname = staleResolution.location;
			return new Response(null, {
				status: 301,
				headers: {
					Location: url.toString(),
					"Cache-Control": "public, max-age=86400",
				},
			});
		}
		if (staleResolution.kind === "gone") {
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
