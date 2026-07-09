import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../../test/seed";
import { sendChatReopenNotification, startChatSession } from "./chat";

const PAGE = { locSlug: "warszawa", businessSlug: "hydraulik-warszawa" };

async function openChat(startedAt: string, sessionId?: string) {
	const result = await startChatSession(
		env.leadgen,
		{ ...PAGE, sessionId: sessionId ?? null },
		{
			referrer: "https://example.test/source",
			userAgent: "Vitest Agent",
			startedAt,
		},
	);
	if (!result) throw new Error("failed to open chat session");
	return result;
}

async function readSession(sessionId: string) {
	return env.leadgen
		.prepare(
			"SELECT last_opened_at, last_reopen_notified_at FROM chat_sessions WHERE id = ?",
		)
		.bind(sessionId)
		.first<{
			last_opened_at: string | null;
			last_reopen_notified_at: string | null;
		}>();
}

describe("startChatSession reopen detection", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	// Assumptions for issue #49:
	// A brand-new session is not a reopen; its last_opened_at equals the start time.
	// Reopening the same still-active session is flagged reopened and advances last_opened_at.
	it("marks a brand-new session as not reopened and records the open time", async () => {
		const result = await openChat("2026-05-26T10:00:00.000Z");

		expect(result).toEqual({
			sessionId: expect.any(String),
			status: "active",
			reopened: false,
		});
		const row = await readSession(result.sessionId);
		expect(row?.last_opened_at).toBe("2026-05-26T10:00:00.000Z");
	});

	it("marks reopening the same active session as reopened and advances the open time", async () => {
		const first = await openChat("2026-05-26T10:00:00.000Z");
		const reopened = await openChat(
			"2026-05-26T10:20:00.000Z",
			first.sessionId,
		);

		expect(reopened).toEqual({
			sessionId: first.sessionId,
			status: "active",
			reopened: true,
		});
		const row = await readSession(first.sessionId);
		expect(row?.last_opened_at).toBe("2026-05-26T10:20:00.000Z");
	});
});

function mockTelegramFetch() {
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

function telegramCalls(fetchMock: ReturnType<typeof mockTelegramFetch>) {
	return fetchMock.mock.calls.filter(([input]) =>
		input.toString().includes("api.telegram.org"),
	);
}

async function markStartNotified(sessionId: string, sentAt: string) {
	await env.leadgen
		.prepare("UPDATE chat_sessions SET telegram_start_sent_at = ? WHERE id = ?")
		.bind(sentAt, sessionId)
		.run();
}

describe("sendChatReopenNotification", () => {
	let originalFetch: typeof fetch;
	let fetchMock: ReturnType<typeof mockTelegramFetch>;

	beforeEach(async () => {
		await resetDb(env.leadgen);
		originalFetch = globalThis.fetch;
		fetchMock = mockTelegramFetch();
		globalThis.fetch = fetchMock as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	// Assumptions for issue #49:
	// A reopen past the quiet period sends exactly one "reopened" Telegram notification,
	// carrying the page slug, reopen timestamp, and referrer, and stamps last_reopen_notified_at.
	it("sends one reopen notification when the session is reopened after the quiet period", async () => {
		const session = await openChat("2026-05-26T10:00:00.000Z");
		await markStartNotified(session.sessionId, "2026-05-26T10:00:00.000Z");
		await openChat("2026-05-26T10:16:00.000Z", session.sessionId);

		await sendChatReopenNotification(
			env,
			session.sessionId,
			new Date("2026-05-26T10:16:00.000Z"),
		);

		const calls = telegramCalls(fetchMock);
		expect(calls).toHaveLength(1);
		const payload = JSON.parse(calls[0][1]?.body as string) as {
			chat_id: string;
			text: string;
		};
		expect(payload.chat_id).toBe("100001");
		expect(payload.text).toContain("ponownie");
		expect(payload.text).toContain("warszawa/hydraulik-warszawa");
		expect(payload.text).toContain("2026-05-26T10:16:00.000Z");
		expect(payload.text).toContain("https://example.test/source");
		expect(payload.text).toContain(
			`Transkrypt: https://example.test/panel/test-token?chat=${session.sessionId}`,
		);

		const row = await readSession(session.sessionId);
		expect(row?.last_reopen_notified_at).toBe("2026-05-26T10:16:00.000Z");
	});

	// Reopening repeatedly within the quiet period must not spam Telegram.
	it("does not send a reopen notification within the quiet period", async () => {
		const session = await openChat("2026-05-26T10:00:00.000Z");
		await markStartNotified(session.sessionId, "2026-05-26T10:00:00.000Z");
		await openChat("2026-05-26T10:05:00.000Z", session.sessionId);

		await sendChatReopenNotification(
			env,
			session.sessionId,
			new Date("2026-05-26T10:05:00.000Z"),
		);

		expect(telegramCalls(fetchMock)).toHaveLength(0);
		const row = await readSession(session.sessionId);
		expect(row?.last_reopen_notified_at).toBeNull();
	});

	// After one reopen notification, a further reopen within the quiet period of
	// that notification must stay silent — the baseline advances to the last reopen.
	it("does not re-notify for a reopen within the quiet period of a prior reopen", async () => {
		const session = await openChat("2026-05-26T10:00:00.000Z");
		await markStartNotified(session.sessionId, "2026-05-26T10:00:00.000Z");

		await openChat("2026-05-26T10:16:00.000Z", session.sessionId);
		await sendChatReopenNotification(
			env,
			session.sessionId,
			new Date("2026-05-26T10:16:00.000Z"),
		);

		await openChat("2026-05-26T10:20:00.000Z", session.sessionId);
		await sendChatReopenNotification(
			env,
			session.sessionId,
			new Date("2026-05-26T10:20:00.000Z"),
		);

		expect(telegramCalls(fetchMock)).toHaveLength(1);
		const row = await readSession(session.sessionId);
		expect(row?.last_reopen_notified_at).toBe("2026-05-26T10:16:00.000Z");
	});

	// A failed delivery must not consume the quiet-period budget, so the next
	// reopen can retry instead of being silently suppressed.
	it("does not mark a reopen as notified when Telegram rejects delivery", async () => {
		globalThis.fetch = mockRejectedTelegramFetch() as unknown as typeof fetch;
		const session = await openChat("2026-05-26T10:00:00.000Z");
		await markStartNotified(session.sessionId, "2026-05-26T10:00:00.000Z");
		await openChat("2026-05-26T10:16:00.000Z", session.sessionId);

		await sendChatReopenNotification(
			env,
			session.sessionId,
			new Date("2026-05-26T10:16:00.000Z"),
		);

		const row = await readSession(session.sessionId);
		expect(row?.last_reopen_notified_at).toBeNull();
	});
});
