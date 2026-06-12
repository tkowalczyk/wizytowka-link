import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import {
	parseStartChatInput,
	sendChatStartNotification,
	startChatSession,
} from "../../../lib/chat";
import { isChatStartRateLimited } from "../../../lib/chat-rate-limit";

function json(data: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const POST: APIRoute = async ({ request, locals }) => {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return json({ error: "nieprawidlowe dane" }, 400);
	}

	const input = parseStartChatInput(rawBody);
	if (!input) return json({ error: "nieprawidlowe dane" }, 400);

	if (await isChatStartRateLimited(env.STATE, request, input)) {
		return json({ error: "za duzo prob" }, 429);
	}

	const result = await startChatSession(env.leadgen, input, {
		referrer: request.headers.get("Referer"),
		userAgent: request.headers.get("User-Agent"),
	});

	if (!result) return json({ error: "nie znaleziono strony" }, 404);

	locals.cfContext.waitUntil(
		sendChatStartNotification(env, result.sessionId).catch((error) => {
			console.error("chat start notification failed:", error);
		}),
	);

	return json({ sessionId: result.sessionId, status: result.status });
};
