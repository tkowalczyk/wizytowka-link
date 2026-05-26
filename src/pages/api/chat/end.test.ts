import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../../../../test/seed";
import { startChatSession } from "../../../lib/chat";
import { POST } from "./end";

interface ChatEndResponse {
	session: {
		sessionId: string;
		status: "ended";
		endReason: "visitor";
		endedAt: string;
		messageCount?: number;
		intentSummary?: string;
		intentCategories?: string[];
		hasComplaint?: boolean;
		hasCommercialDemand?: boolean;
	};
}

function chatEndRequest(body: Record<string, unknown>): Request {
	return new Request("https://wizytowka.link/api/chat/end", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
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

function telegramCalls(fetchMock: ReturnType<typeof mockFetch>) {
	return fetchMock.mock.calls.filter(([input]) =>
		input.toString().includes("api.telegram.org"),
	);
}

async function submitChatEnd(body: Record<string, unknown>): Promise<{
	response: Response;
	settled: Promise<PromiseSettledResult<unknown>[]>;
}> {
	const ctx = createCfContext();
	const response = await POST({
		request: chatEndRequest(body),
		locals: ctx.locals,
	} as Parameters<typeof POST>[0]);
	return { response, settled: ctx.settle() };
}

async function activeSessionId() {
	const result = await startChatSession(
		env.leadgen,
		{ locSlug: "warszawa", businessSlug: "hydraulik-warszawa" },
		{
			referrer: "https://example.test/source",
			userAgent: "Vitest Agent",
			startedAt: "2026-05-26T10:00:00.000Z",
		},
	);
	if (!result) throw new Error("failed to create test chat session");
	return result.sessionId;
}

describe("POST /api/chat/end", () => {
	let originalFetch: typeof fetch;

	beforeEach(async () => {
		await resetDb(env.leadgen);
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	// Assumptions for issue #46:
	// Request body is { sessionId } for the current chat session.
	// Explicit visitor ending stores end_reason='visitor' and returns a summary.
	// Browser/tab close is intentionally not encoded as a durable end reason.
	it("ends an active session with visitor reason and returns the ended session summary", async () => {
		const sessionId = await activeSessionId();

		const response = await POST({
			request: chatEndRequest({ sessionId }),
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		const body = (await response.json()) as ChatEndResponse;
		expect(body.session).toEqual({
			sessionId,
			status: "ended",
			endReason: "visitor",
			endedAt: expect.any(String),
			messageCount: 0,
			intentSummary: "Brak jednoznacznej intencji w rozmowie.",
			intentCategories: [],
			hasComplaint: false,
			hasCommercialDemand: false,
		});

		const row = await env.leadgen
			.prepare(
				"SELECT status, end_reason, ended_at FROM chat_sessions WHERE id = ?",
			)
			.bind(sessionId)
			.first<{
				status: string;
				end_reason: string | null;
				ended_at: string | null;
			}>();

		expect(row).toEqual({
			status: "ended",
			end_reason: "visitor",
			ended_at: body.session.endedAt,
		});
	});

	it("computes message count from stored messages when ending a session", async () => {
		const sessionId = await activeSessionId();
		await env.leadgen
			.prepare(
				`INSERT INTO chat_messages (
         id, session_id, locality_slug, business_slug, role, content, message_index, created_at
       ) VALUES
         ('msg-visitor-1', ?, 'warszawa', 'hydraulik-warszawa', 'visitor', 'Jaki jest adres?', 1, '2026-05-26T10:01:00.000Z'),
         ('msg-assistant-1', ?, 'warszawa', 'hydraulik-warszawa', 'assistant', 'Adres to ul. Marszałkowska 1.', 2, '2026-05-26T10:01:01.000Z')`,
			)
			.bind(sessionId, sessionId)
			.run();

		const response = await POST({
			request: chatEndRequest({ sessionId }),
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		const body = (await response.json()) as ChatEndResponse;
		expect(body.session.messageCount).toBe(2);

		const row = await env.leadgen
			.prepare("SELECT message_count FROM chat_sessions WHERE id = ?")
			.bind(sessionId)
			.first<{ message_count: number | null }>();
		expect(row?.message_count).toBe(2);
	});

	it("stores intent summary, specific categories, and complaint/commercial flags", async () => {
		const sessionId = await activeSessionId();
		await env.leadgen
			.prepare(
				`INSERT INTO chat_messages (
         id, session_id, locality_slug, business_slug, role, content, message_index, created_at
       ) VALUES
         ('msg-visitor-intent', ?, 'warszawa', 'hydraulik-warszawa', 'visitor', 'Chcę złożyć reklamację i zapytać o wycenę.', 1, '2026-05-26T10:01:00.000Z'),
         ('msg-assistant-intent', ?, 'warszawa', 'hydraulik-warszawa', 'assistant', 'Ta sprawa wymaga kontaktu z człowiekiem.', 2, '2026-05-26T10:01:01.000Z')`,
			)
			.bind(sessionId, sessionId)
			.run();

		const response = await POST({
			request: chatEndRequest({ sessionId }),
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		const body = (await response.json()) as ChatEndResponse;
		expect(body.session.intentCategories).toEqual([
			"quote_pricing",
			"complaint",
		]);
		expect(body.session.intentSummary).toContain("quote_pricing");
		expect(body.session.intentSummary).toContain("complaint");
		expect(body.session.hasComplaint).toBe(true);
		expect(body.session.hasCommercialDemand).toBe(true);

		const row = await env.leadgen
			.prepare(
				`SELECT intent_summary, intent_categories, has_complaint, has_commercial_demand
         FROM chat_sessions WHERE id = ?`,
			)
			.bind(sessionId)
			.first<{
				intent_summary: string | null;
				intent_categories: string | null;
				has_complaint: number;
				has_commercial_demand: number;
			}>();
		expect(row).toEqual({
			intent_summary: body.session.intentSummary,
			intent_categories: JSON.stringify(body.session.intentCategories),
			has_complaint: 1,
			has_commercial_demand: 1,
		});
	});

	it("sends one Telegram end notification with slug, summary, message count, and transcript link", async () => {
		const fetchMock = mockFetch();
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const sessionId = await activeSessionId();
		await env.leadgen
			.prepare(
				`INSERT INTO chat_messages (
         id, session_id, locality_slug, business_slug, role, content, message_index, created_at
       ) VALUES
         ('msg-visitor-telegram', ?, 'warszawa', 'hydraulik-warszawa', 'visitor', 'Jaka jest cena naprawy?', 1, '2026-05-26T10:01:00.000Z'),
         ('msg-assistant-telegram', ?, 'warszawa', 'hydraulik-warszawa', 'assistant', 'Ta sprawa wymaga kontaktu z człowiekiem.', 2, '2026-05-26T10:01:01.000Z')`,
			)
			.bind(sessionId, sessionId)
			.run();

		const first = await submitChatEnd({ sessionId });
		expect(first.response.status).toBe(200);
		await first.settled;
		const second = await submitChatEnd({ sessionId });
		expect(second.response.status).toBe(200);
		await second.settled;

		const calls = telegramCalls(fetchMock);
		expect(calls).toHaveLength(1);
		const payload = JSON.parse(calls[0][1]?.body as string) as {
			chat_id: string;
			text: string;
		};
		expect(payload.chat_id).toBe("100001");
		expect(payload.text).toContain("warszawa/hydraulik-warszawa");
		expect(payload.text).toContain("quote_pricing");
		expect(payload.text).toContain("Wiadomości: 2");
		expect(payload.text).toContain(`/s/seller_jan_token?chat=${sessionId}`);

		const row = await env.leadgen
			.prepare("SELECT telegram_end_sent_at FROM chat_sessions WHERE id = ?")
			.bind(sessionId)
			.first<{ telegram_end_sent_at: string | null }>();
		expect(row?.telegram_end_sent_at).toEqual(expect.any(String));
	});
});
