import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import {
	endChatSession,
	parseEndChatInput,
	sendChatEndNotification,
} from "../../../lib/chat";

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

	const input = parseEndChatInput(rawBody);
	if (!input) return json({ error: "nieprawidlowe dane" }, 400);

	const result = await endChatSession(env.leadgen, input);
	if (result.status === "not_found") {
		return json({ error: "nie znaleziono sesji" }, 404);
	}

	locals?.cfContext?.waitUntil(
		sendChatEndNotification(env, result.session.sessionId).catch((error) => {
			console.error("chat end notification failed:", error);
		}),
	);

	return json({ session: result.session });
};
