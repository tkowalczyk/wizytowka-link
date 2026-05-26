import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../../test/seed";
import { startChatSession } from "./chat";
import { CRON_PATTERNS, runScheduledCron } from "./scheduled";

function executionContext(): ExecutionContext {
	return {
		waitUntil: () => {},
		passThroughOnException: () => {},
	} as unknown as ExecutionContext;
}

function mockFetch() {
	return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const url = input.toString();
		if (url.includes("api.telegram.org")) {
			return Response.json({
				ok: true,
				result: { message_id: 1, chat: { id: 1, type: "private" }, date: 0 },
			});
		}
		throw new Error(`Unexpected fetch: ${url}`);
	});
}

function telegramCalls(fetchMock: ReturnType<typeof mockFetch>) {
	return fetchMock.mock.calls.filter(([input]) =>
		input.toString().includes("api.telegram.org"),
	);
}

async function activeSessionId(startedAt: string) {
	const result = await startChatSession(
		env.leadgen,
		{ locSlug: "warszawa", businessSlug: "hydraulik-warszawa" },
		{
			referrer: "https://example.test/source",
			userAgent: "Vitest Agent",
			startedAt,
		},
	);
	if (!result) throw new Error("failed to create test chat session");
	return result.sessionId;
}

describe("runScheduledCron", () => {
	let originalFetch: typeof fetch;

	beforeEach(async () => {
		await resetDb(env.leadgen);
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("runs the server-side chat timeout sweep and end notification as a durable scheduled job", async () => {
		const fetchMock = mockFetch();
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const sessionId = await activeSessionId("2020-01-01T00:00:00.000Z");

		const result = await runScheduledCron(
			env,
			CRON_PATTERNS.chatTimeout,
			executionContext(),
		);

		expect(result).toMatchObject({ processed: 1, failed: 0 });
		const row = await env.leadgen
			.prepare("SELECT status, end_reason FROM chat_sessions WHERE id = ?")
			.bind(sessionId)
			.first<{ status: string; end_reason: string | null }>();
		expect(row).toEqual({ status: "ended", end_reason: "timeout" });
		expect(telegramCalls(fetchMock)).toHaveLength(1);
	});
});
