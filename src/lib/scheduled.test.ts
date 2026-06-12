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

function mockTelegramFetchSequence(responses: Array<{ ok: boolean }>) {
	return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const url = input.toString();
		if (url.includes("api.telegram.org")) {
			const response = responses.shift() ?? { ok: true };
			return Response.json(
				response.ok
					? {
							ok: true,
							result: {
								message_id: 1,
								chat: { id: 1, type: "private" },
								date: 0,
							},
						}
					: {
							ok: false,
							error_code: 429,
							description: "Too Many Requests",
						},
			);
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

	// Assumptions for issue #53:
	// Any ended session with telegram_end_sent_at=NULL is retryable on each timeout sweep.
	// Telegram ok=false means the end notification was not delivered and must stay retryable.
	// This slice does not cover concurrent callers; that race is covered in the chat end API test.
	it("retries unsent end notifications on the next chatTimeout sweep", async () => {
		const fetchMock = mockTelegramFetchSequence([{ ok: false }, { ok: true }]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const sessionId = await activeSessionId("2020-01-01T00:00:00.000Z");

		const first = await runScheduledCron(
			env,
			CRON_PATTERNS.chatTimeout,
			executionContext(),
		);

		expect(first).toMatchObject({ processed: 1, failed: 0 });
		expect(telegramCalls(fetchMock)).toHaveLength(1);
		const afterFailure = await env.leadgen
			.prepare("SELECT telegram_end_sent_at FROM chat_sessions WHERE id = ?")
			.bind(sessionId)
			.first<{ telegram_end_sent_at: string | null }>();
		expect(afterFailure?.telegram_end_sent_at).toBeNull();

		const second = await runScheduledCron(
			env,
			CRON_PATTERNS.chatTimeout,
			executionContext(),
		);

		expect(second).toMatchObject({ processed: 0, failed: 0 });
		expect(telegramCalls(fetchMock)).toHaveLength(2);
		const afterRetry = await env.leadgen
			.prepare("SELECT telegram_end_sent_at FROM chat_sessions WHERE id = ?")
			.bind(sessionId)
			.first<{ telegram_end_sent_at: string | null }>();
		expect(afterRetry?.telegram_end_sent_at).toEqual(expect.any(String));
	});
});
