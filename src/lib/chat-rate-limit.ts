import type { StartChatInput } from "./chat";

export const CHAT_MESSAGE_RATE_LIMIT_MAX = 10;
export const CHAT_MESSAGE_RATE_LIMIT_WINDOW_SECONDS = 60;
export const CHAT_START_RATE_LIMIT_TTL_SECONDS = 15 * 60;

function getClientIp(request: Request): string {
	return (
		request.headers.get("CF-Connecting-IP") ??
		request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
		"unknown"
	);
}

async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function isFixedWindowRateLimited(
	state: KVNamespace,
	key: string,
	max: number,
	ttlSeconds: number,
): Promise<boolean> {
	const existing = await state.get(key);
	const count = existing ? Number.parseInt(existing, 10) : 0;
	if (Number.isFinite(count) && count >= max) return true;
	await state.put(key, String((Number.isFinite(count) ? count : 0) + 1), {
		expirationTtl: ttlSeconds,
	});
	return false;
}

export async function isChatMessageRateLimited(
	state: KVNamespace,
	request: Request,
	sessionId: string,
): Promise<boolean> {
	const ip = getClientIp(request);
	const hash = await sha256Hex(`${ip}:${sessionId}`);
	return isFixedWindowRateLimited(
		state,
		`chat:v1:messages:${hash}`,
		CHAT_MESSAGE_RATE_LIMIT_MAX,
		CHAT_MESSAGE_RATE_LIMIT_WINDOW_SECONDS,
	);
}

export async function isChatStartRateLimited(
	state: KVNamespace,
	request: Request,
	input: StartChatInput,
): Promise<boolean> {
	if (input.sessionId) return false;
	const ip = getClientIp(request);
	const hash = await sha256Hex(`${ip}:${input.locSlug}:${input.businessSlug}`);
	return isFixedWindowRateLimited(
		state,
		`chat:v1:start:${hash}`,
		1,
		CHAT_START_RATE_LIMIT_TTL_SECONDS,
	);
}
