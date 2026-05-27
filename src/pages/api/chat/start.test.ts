import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, TEST_IDS } from "../../../../test/seed";
import { POST } from "./start";

interface ChatStartResponse {
	sessionId: string;
	status: "active";
}

function chatStartRequest(body: Record<string, unknown>): Request {
	return new Request("https://wizytowka.link/api/chat/start", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Referer: "https://example.test/source",
			"User-Agent": "Vitest Agent",
		},
		body: JSON.stringify(body),
	});
}

function createCfContext() {
	const pending: Promise<unknown>[] = [];
	return {
		locals: {
			cfContext: {
				waitUntil: (p: Promise<unknown>) => {
					pending.push(p);
				},
				passThroughOnException: () => {},
			},
		},
		settle: () => Promise.allSettled(pending),
	};
}

function mockFetch() {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input.toString();
		if (url.includes("api.telegram.org")) {
			return Response.json({
				ok: true,
				result: { message_id: 1, chat: { id: 1, type: "private" }, date: 0 },
			});
		}
		throw new Error(`Unexpected fetch: ${url} ${String(init?.body ?? "")}`);
	});
}

function mockRejectedTelegramFetch() {
	return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const url = input.toString();
		if (url.includes("api.telegram.org")) {
			return Response.json({
				ok: false,
				error_code: 400,
				description: "Bad Request: chat not found",
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

async function submitChatStart(body: Record<string, unknown>): Promise<{
	response: Response;
	settled: Promise<PromiseSettledResult<unknown>[]>;
}> {
	const ctx = createCfContext();
	const response = await POST({
		request: chatStartRequest(body),
		locals: ctx.locals,
	} as Parameters<typeof POST>[0]);
	return { response, settled: ctx.settle() };
}

describe("POST /api/chat/start", () => {
	let originalFetch: typeof fetch;
	let fetchMock: ReturnType<typeof mockFetch>;

	beforeEach(async () => {
		await resetDb(env.leadgen);
		originalFetch = globalThis.fetch;
		fetchMock = mockFetch();
		globalThis.fetch = fetchMock as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	// Assumptions for issue #44:
	// Request body identifies the current generated page as { locSlug, businessSlug, sessionId? }.
	// Referrer and user agent are read from request headers.
	// Retrying with a known active sessionId returns that stored session.
	it("creates an active chat session for the current generated page", async () => {
		const { response, settled } = await submitChatStart({
			locSlug: "warszawa",
			businessSlug: "hydraulik-warszawa",
		});
		await settled;

		expect(response.status).toBe(200);
		const body = (await response.json()) as ChatStartResponse;
		expect(body).toEqual({
			sessionId: expect.any(String),
			status: "active",
		});

		const row = await env.leadgen
			.prepare(
				`SELECT id, business_id, locality_slug, business_slug, status, referrer, user_agent, started_at
         FROM chat_sessions WHERE id = ?`,
			)
			.bind(body.sessionId)
			.first<{
				id: string;
				business_id: number;
				locality_slug: string;
				business_slug: string;
				status: string;
				referrer: string | null;
				user_agent: string | null;
				started_at: string;
			}>();

		expect(row).toEqual({
			id: body.sessionId,
			business_id: TEST_IDS.businesses.hydraulikWarszawa,
			locality_slug: "warszawa",
			business_slug: "hydraulik-warszawa",
			status: "active",
			referrer: "https://example.test/source",
			user_agent: "Vitest Agent",
			started_at: expect.any(String),
		});
	});

	it("records a chat-start event joinable to page visits by generated page slug", async () => {
		await env.leadgen
			.prepare(
				`INSERT INTO analytics_events (
         event_type, locality_slug, business_slug, referrer, user_agent
       ) VALUES ('page_visit', 'warszawa', 'hydraulik-warszawa', 'https://example.test/source', 'Vitest Agent')`,
			)
			.run();

		const { response, settled } = await submitChatStart({
			locSlug: "warszawa",
			businessSlug: "hydraulik-warszawa",
		});
		await settled;
		const body = (await response.json()) as ChatStartResponse;

		const joined = await env.leadgen
			.prepare(
				`SELECT COUNT(*) AS count
         FROM analytics_events pv
         JOIN analytics_events cs
           ON pv.locality_slug = cs.locality_slug
          AND pv.business_slug = cs.business_slug
         WHERE pv.event_type = 'page_visit'
           AND cs.event_type = 'chat_start'
           AND cs.session_id = ?`,
			)
			.bind(body.sessionId)
			.first<{ count: number }>();

		expect(joined?.count).toBe(1);
	});

	it("sends one Telegram start notification with slug, timestamp, and referrer", async () => {
		const { response, settled } = await submitChatStart({
			locSlug: "warszawa",
			businessSlug: "hydraulik-warszawa",
		});
		const body = (await response.json()) as ChatStartResponse;
		await settled;

		const row = await env.leadgen
			.prepare(
				"SELECT started_at, telegram_start_sent_at FROM chat_sessions WHERE id = ?",
			)
			.bind(body.sessionId)
			.first<{ started_at: string; telegram_start_sent_at: string | null }>();

		const calls = telegramCalls(fetchMock);
		expect(calls).toHaveLength(1);
		const payload = JSON.parse(calls[0][1]?.body as string) as {
			chat_id: string;
			text: string;
		};
		expect(payload.chat_id).toBe("100001");
		expect(payload.text).toContain("warszawa/hydraulik-warszawa");
		expect(payload.text).toContain(row?.started_at);
		expect(payload.text).toContain("https://example.test/source");
		expect(payload.text).not.toContain("Session:");
		expect(payload.text).toContain(
			`Transkrypt: https://example.test/panel/test-token?chat=${body.sessionId}`,
		);
		expect(row?.telegram_start_sent_at).toEqual(expect.any(String));
	});

	it("does not resend the Telegram start notification when retrying the same active session", async () => {
		const first = await submitChatStart({
			locSlug: "warszawa",
			businessSlug: "hydraulik-warszawa",
		});
		const firstBody = (await first.response.json()) as ChatStartResponse;
		await first.settled;

		const second = await submitChatStart({
			locSlug: "warszawa",
			businessSlug: "hydraulik-warszawa",
			sessionId: firstBody.sessionId,
		});
		const secondBody = (await second.response.json()) as ChatStartResponse;
		await second.settled;

		expect(secondBody.sessionId).toBe(firstBody.sessionId);
		expect(telegramCalls(fetchMock)).toHaveLength(1);
	});

	it("does not mark a start notification as sent when Telegram rejects delivery", async () => {
		globalThis.fetch = mockRejectedTelegramFetch() as unknown as typeof fetch;
		const { response, settled } = await submitChatStart({
			locSlug: "warszawa",
			businessSlug: "hydraulik-warszawa",
		});
		const body = (await response.json()) as ChatStartResponse;
		await settled;

		const row = await env.leadgen
			.prepare("SELECT telegram_start_sent_at FROM chat_sessions WHERE id = ?")
			.bind(body.sessionId)
			.first<{ telegram_start_sent_at: string | null }>();
		expect(row?.telegram_start_sent_at).toBeNull();
	});
});
