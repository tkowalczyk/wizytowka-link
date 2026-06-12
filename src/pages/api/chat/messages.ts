import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import {
	createZAIChatProvider,
	parseChatMessageInput,
	sendChatMessage,
} from "../../../lib/chat";
import { isChatMessageRateLimited } from "../../../lib/chat-rate-limit";

function json(data: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const POST: APIRoute = async ({ request }) => {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return json({ error: "nieprawidlowe dane" }, 400);
	}

	const input = parseChatMessageInput(rawBody);
	if (!input) return json({ error: "nieprawidlowe dane" }, 400);

	if (await isChatMessageRateLimited(env.STATE, request, input.sessionId)) {
		return json({ error: "za duzo prob" }, 429);
	}

	const result = await sendChatMessage(
		env.leadgen,
		env.sites,
		input,
		createZAIChatProvider(env.ZAI_API_KEY),
	);

	if (result.status === "not_found") {
		return json({ error: "nie znaleziono sesji" }, 404);
	}
	if (result.status === "ended") {
		return json({ error: "sesja zakonczona" }, 409);
	}
	if (result.status === "rate_limited") {
		return json({ error: "za duzo prob" }, 429);
	}

	return json({ message: result.message });
};
