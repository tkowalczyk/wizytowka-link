import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TEST_IDS } from "../../test/seed";
import { startChatSession } from "./chat";
import { loadSellerChatEvidence } from "./seller-evidence";

async function activeSessionId() {
	const result = await startChatSession(
		env.leadgen,
		{ locSlug: "warszawa", businessSlug: "hydraulik-warszawa" },
		{
			referrer: "https://example.test/ref",
			userAgent: "Vitest Agent",
			startedAt: "2026-05-26T10:00:00.000Z",
		},
	);
	if (!result) throw new Error("failed to create test chat session");
	return result.sessionId;
}

describe("loadSellerChatEvidence", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	// Assumptions for issue #47:
	// The seller/admin route remains /s/{sellerToken} with optional ?chat={sessionId}.
	// V1 has one seller/admin compatibility layer, so a valid seller token can review an existing chat session.
	// Invalid tokens or missing sessions must produce the same null result so callers can return a non-disclosing 404.
	// This helper intentionally does not add live reply, export, portal, or route-renaming behavior.
	it("loads a protected chat transcript for a valid seller/admin token and session id", async () => {
		const sessionId = await activeSessionId();

		const evidence = await loadSellerChatEvidence(
			env.leadgen,
			TEST_IDS.tokens.sellerJan,
			sessionId,
		);

		expect(evidence?.seller.id).toBe(TEST_IDS.sellers.jan);
		expect(evidence?.session).toEqual(
			expect.objectContaining({
				id: sessionId,
				localitySlug: "warszawa",
				businessSlug: "hydraulik-warszawa",
				startedAt: "2026-05-26T10:00:00.000Z",
				referrer: "https://example.test/ref",
				userAgent: "Vitest Agent",
			}),
		);
		expect(evidence?.messages).toEqual([]);
	});

	it("loads transcript messages in chronological order with session metadata", async () => {
		const sessionId = await activeSessionId();
		await env.leadgen
			.prepare(
				`INSERT INTO chat_messages (
         id, session_id, locality_slug, business_slug, role, content, message_index, created_at
       ) VALUES
         ('msg-assistant-late', ?, 'warszawa', 'hydraulik-warszawa', 'assistant', 'Ta sprawa wymaga kontaktu z człowiekiem.', 2, '2026-05-26T10:01:05.000Z'),
         ('msg-visitor-early', ?, 'warszawa', 'hydraulik-warszawa', 'visitor', 'Jaka jest cena naprawy?', 1, '2026-05-26T10:01:00.000Z')`,
			)
			.bind(sessionId, sessionId)
			.run();
		await env.leadgen
			.prepare(
				`UPDATE chat_sessions
       SET status = 'ended',
           ended_at = '2026-05-26T10:02:00.000Z',
           end_reason = 'visitor',
           message_count = 2,
           intent_summary = 'Wykryte intencje: quote_pricing.',
           intent_categories = '["quote_pricing"]',
           has_commercial_demand = 1
       WHERE id = ?`,
			)
			.bind(sessionId)
			.run();

		const evidence = await loadSellerChatEvidence(
			env.leadgen,
			TEST_IDS.tokens.sellerJan,
			sessionId,
		);

		expect(evidence?.session).toEqual(
			expect.objectContaining({
				id: sessionId,
				status: "ended",
				localitySlug: "warszawa",
				businessSlug: "hydraulik-warszawa",
				startedAt: "2026-05-26T10:00:00.000Z",
				endedAt: "2026-05-26T10:02:00.000Z",
				referrer: "https://example.test/ref",
				userAgent: "Vitest Agent",
				endReason: "visitor",
				messageCount: 2,
				intentSummary: "Wykryte intencje: quote_pricing.",
				intentCategories: ["quote_pricing"],
				hasComplaint: false,
				hasCommercialDemand: true,
			}),
		);
		expect(evidence?.messages.map((message) => message.content)).toEqual([
			"Jaka jest cena naprawy?",
			"Ta sprawa wymaga kontaktu z człowiekiem.",
		]);
	});

	it("computes chat start rate and supporting evidence metrics for the page", async () => {
		await env.leadgen
			.prepare(
				`INSERT INTO chat_sessions (
         id, business_id, locality_slug, business_slug, started_at, ended_at, status,
         end_reason, message_count, intent_summary, intent_categories,
         has_complaint, has_commercial_demand
       ) VALUES
         ('chat-price', ?, 'warszawa', 'hydraulik-warszawa', '2026-05-26T10:00:00.000Z', '2026-05-26T10:02:00.000Z', 'ended',
          'visitor', 2, 'Wykryte intencje: quote_pricing.', '["quote_pricing"]', 0, 1),
         ('chat-booking', ?, 'warszawa', 'hydraulik-warszawa', '2026-05-26T11:00:00.000Z', '2026-05-26T11:04:00.000Z', 'ended',
          'visitor', 4, 'Wykryte intencje: booking_reservation.', '["booking_reservation"]', 0, 1),
         ('chat-complaint', ?, 'warszawa', 'hydraulik-warszawa', '2026-05-26T12:00:00.000Z', '2026-05-26T12:06:00.000Z', 'ended',
          'visitor', 6, 'Wykryte intencje: complaint.', '["complaint"]', 1, 0)`,
			)
			.bind(
				TEST_IDS.businesses.hydraulikWarszawa,
				TEST_IDS.businesses.hydraulikWarszawa,
				TEST_IDS.businesses.hydraulikWarszawa,
			)
			.run();
		await env.leadgen
			.prepare(
				`INSERT INTO analytics_events (
         event_type, locality_slug, business_slug, session_id, occurred_at
       ) VALUES
         ('page_visit', 'warszawa', 'hydraulik-warszawa', NULL, '2026-05-26T09:00:00.000Z'),
         ('page_visit', 'warszawa', 'hydraulik-warszawa', NULL, '2026-05-26T09:01:00.000Z'),
         ('page_visit', 'warszawa', 'hydraulik-warszawa', NULL, '2026-05-26T09:02:00.000Z'),
         ('page_visit', 'warszawa', 'hydraulik-warszawa', NULL, '2026-05-26T09:03:00.000Z'),
         ('chat_start', 'warszawa', 'hydraulik-warszawa', 'chat-price', '2026-05-26T10:00:00.000Z'),
         ('chat_start', 'warszawa', 'hydraulik-warszawa', 'chat-booking', '2026-05-26T11:00:00.000Z'),
         ('chat_start', 'warszawa', 'hydraulik-warszawa', 'chat-complaint', '2026-05-26T12:00:00.000Z')`,
			)
			.run();

		const evidence = await loadSellerChatEvidence(
			env.leadgen,
			TEST_IDS.tokens.sellerJan,
			"chat-price",
		);

		expect(evidence?.metrics).toEqual({
			pageVisits: 4,
			chatStarts: 3,
			chatStartRate: 0.75,
			totalChats: 3,
			totalMessageCount: 12,
			averageMessageCount: 4,
			specificIntentCount: 3,
			repeatedDemandCount: 2,
			commercialDemandCount: 2,
			complaintCount: 1,
		});
	});
});
