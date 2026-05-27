import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TEST_IDS } from "../../test/seed";
import { startChatSession } from "./chat";
import { loadSellerPanelRouteData } from "./seller-panel-data";

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

describe("loadSellerPanelRouteData", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	it("keeps the existing seller/admin lead list route without a chat deep link", async () => {
		const data = await loadSellerPanelRouteData(
			env.leadgen,
			TEST_IDS.tokens.sellerJan,
			new URL("https://wizytowka.link/s/seller_jan_token"),
		);

		expect(data?.seller.id).toBe(TEST_IDS.sellers.jan);
		expect(data?.chatEvidence).toBeNull();
		expect(data?.leadPage.total).toBeGreaterThan(0);
		expect(data?.currentSite).toBe("generated");
	});

	it("keeps the seller/admin lead list while opening a chat transcript deep link", async () => {
		const sessionId = await activeSessionId();
		const data = await loadSellerPanelRouteData(
			env.leadgen,
			TEST_IDS.tokens.sellerJan,
			new URL(`https://wizytowka.link/s/seller_jan_token?chat=${sessionId}`),
		);

		expect(data?.seller.id).toBe(TEST_IDS.sellers.jan);
		expect(data?.leadPage.total).toBeGreaterThan(0);
		expect(data?.leadPage.leads.map((lead) => lead.biz_slug)).toContain(
			"hydraulik-warszawa",
		);
		expect(data?.chatEvidence?.session.id).toBe(sessionId);
	});

	it("returns a non-disclosing null result for an invalid seller/admin token", async () => {
		const sessionId = await activeSessionId();
		const data = await loadSellerPanelRouteData(
			env.leadgen,
			"invalid-token",
			new URL(`https://wizytowka.link/s/invalid-token?chat=${sessionId}`),
		);

		expect(data).toBeNull();
	});

	it("returns a non-disclosing null result for an unknown chat session", async () => {
		const data = await loadSellerPanelRouteData(
			env.leadgen,
			TEST_IDS.tokens.sellerJan,
			new URL("https://wizytowka.link/s/seller_jan_token?chat=missing-chat"),
		);

		expect(data).toBeNull();
	});

	it("loads the latest 20 chat sessions for discovery on the seller/admin page", async () => {
		for (let index = 1; index <= 21; index += 1) {
			const id = `recent-chat-${String(index).padStart(2, "0")}`;
			await env.leadgen
				.prepare(
					`INSERT INTO chat_sessions (
             id, business_id, locality_slug, business_slug, started_at, ended_at,
             status, end_reason, message_count, intent_summary, intent_categories,
             has_complaint, has_commercial_demand
           ) VALUES (?, ?, 'warszawa', 'hydraulik-warszawa', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					id,
					TEST_IDS.businesses.hydraulikWarszawa,
					`2026-05-26T10:${String(index).padStart(2, "0")}:00.000Z`,
					index % 2 === 0
						? `2026-05-26T10:${String(index).padStart(2, "0")}:30.000Z`
						: null,
					index % 2 === 0 ? "ended" : "active",
					index % 2 === 0 ? "visitor" : null,
					index,
					index % 3 === 0 ? "Wykryte intencje: complaint." : null,
					index % 3 === 0 ? '["complaint"]' : "[]",
					index % 3 === 0 ? 1 : 0,
					index % 3 === 0 ? 0 : 1,
				)
				.run();
		}

		const data = await loadSellerPanelRouteData(
			env.leadgen,
			TEST_IDS.tokens.sellerJan,
			new URL("https://wizytowka.link/s/seller_jan_token"),
		);

		expect(data?.recentChats).toHaveLength(20);
		expect(data?.recentChats[0]).toEqual(
			expect.objectContaining({
				id: "recent-chat-21",
				status: "active",
				localitySlug: "warszawa",
				businessSlug: "hydraulik-warszawa",
				startedAt: "2026-05-26T10:21:00.000Z",
			}),
		);
		expect(data?.recentChats.at(-1)?.id).toBe("recent-chat-02");
	});
});
