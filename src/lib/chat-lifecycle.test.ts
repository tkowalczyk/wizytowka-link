import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import {
	endInactiveChatSessions,
	sendChatMessage,
	startChatSession,
} from "./chat";

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

async function appendStoredMessage(params: {
	sessionId: string;
	id: string;
	role: "visitor" | "assistant";
	content: string;
	messageIndex: number;
	createdAt: string;
}) {
	await env.leadgen
		.prepare(
			`INSERT INTO chat_messages (
         id, session_id, locality_slug, business_slug, role, content, message_index, created_at
       ) VALUES (?, ?, 'warszawa', 'hydraulik-warszawa', ?, ?, ?, ?)`,
		)
		.bind(
			params.id,
			params.sessionId,
			params.role,
			params.content,
			params.messageIndex,
			params.createdAt,
		)
		.run();
}

describe("chat message storage", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	// Assumptions for issue #51:
	// Two active-session visitor messages may be submitted for the same session concurrently.
	// Success means both sendChatMessage calls return ok and persist one visitor row plus one assistant row each.
	// The durable ordering contract is distinct, gapless message_index values within the session.
	// This slice does not change route-level rate limiting or ended-session behavior.
	it("stores concurrent visitor messages without losing either", async () => {
		const sessionId = await activeSessionId("2026-05-26T10:00:00.000Z");
		const delayedLlm = {
			async complete() {
				await Promise.resolve();
				return "Odpowiedź asystenta.";
			},
		};

		const results = await Promise.all([
			sendChatMessage(
				env.leadgen,
				env.sites,
				{ sessionId, content: "pierwsza" },
				delayedLlm,
			),
			sendChatMessage(
				env.leadgen,
				env.sites,
				{ sessionId, content: "druga" },
				delayedLlm,
			),
		]);

		expect(results.map((result) => result.status)).toEqual(["ok", "ok"]);
		const rows = await env.leadgen
			.prepare(
				`SELECT role, content, message_index
         FROM chat_messages
         WHERE session_id = ?
         ORDER BY message_index`,
			)
			.bind(sessionId)
			.all<{
				role: "visitor" | "assistant";
				content: string;
				message_index: number;
			}>();

		expect(rows.results).toHaveLength(4);
		expect(rows.results.map((row) => row.message_index)).toEqual([1, 2, 3, 4]);
		expect(rows.results.filter((row) => row.role === "visitor")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ content: "pierwsza" }),
				expect.objectContaining({ content: "druga" }),
			]),
		);
		expect(rows.results.filter((row) => row.role === "assistant")).toHaveLength(
			2,
		);
	});
});

describe("chat lifecycle timeout sweep", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	// Assumptions for issue #46:
	// The server-side timeout sweep is the durable source of truth for abandoned sessions.
	// Timeout ending stores end_reason='timeout' and uses the sweep clock for ended_at.
	// Browser/tab close signals may exist later, but they are not required for timeout ending.
	it("marks sessions inactive beyond the configured timeout as ended with timeout reason", async () => {
		const sessionId = await activeSessionId("2026-05-26T10:00:00.000Z");

		const result = await endInactiveChatSessions(
			env.leadgen,
			new Date("2026-05-26T10:31:00.000Z"),
		);

		expect(result.ended).toBe(1);
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
			end_reason: "timeout",
			ended_at: "2026-05-26T10:31:00.000Z",
		});
	});

	it("computes inactivity from the latest stored session or message timestamp", async () => {
		const staleSessionId = await activeSessionId("2026-05-26T10:00:00.000Z");
		await appendStoredMessage({
			sessionId: staleSessionId,
			id: "stale-message",
			role: "visitor",
			content: "Wiadomość sprzed progu",
			messageIndex: 1,
			createdAt: "2026-05-26T10:10:00.000Z",
		});
		const freshSessionId = await activeSessionId("2026-05-26T10:00:00.000Z");
		await appendStoredMessage({
			sessionId: freshSessionId,
			id: "fresh-message",
			role: "visitor",
			content: "Wiadomość po progu",
			messageIndex: 1,
			createdAt: "2026-05-26T10:20:00.000Z",
		});

		const result = await endInactiveChatSessions(
			env.leadgen,
			new Date("2026-05-26T10:45:00.000Z"),
		);

		expect(result.ended).toBe(1);
		const rows = await env.leadgen
			.prepare("SELECT id, status, end_reason FROM chat_sessions ORDER BY id")
			.all<{ id: string; status: string; end_reason: string | null }>();
		expect(rows.results).toEqual(
			expect.arrayContaining([
				{ id: staleSessionId, status: "ended", end_reason: "timeout" },
				{ id: freshSessionId, status: "active", end_reason: null },
			]),
		);
	});
});
