import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TEST_IDS } from "../../../../test/seed";
import { PUT } from "./[id]";

function updateLeadRequest(
	id: string | number,
	body: Record<string, unknown>,
	token?: string,
): Request {
	const url = new URL(`https://wizytowka.link/api/leads/${id}`);
	if (token) url.searchParams.set("token", token);
	return new Request(url, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function updateLead(
	id: string | number,
	body: Record<string, unknown>,
	token?: string,
): Promise<Response> {
	return PUT({
		params: { id: String(id) },
		request: updateLeadRequest(id, body, token),
	} as unknown as Parameters<typeof PUT>[0]);
}

async function callLogRows(businessId: number, sellerId: number) {
	const result = await env.leadgen
		.prepare(
			`SELECT status, comment
       FROM call_log
       WHERE business_id = ? AND seller_id = ?
       ORDER BY id DESC`,
		)
		.bind(businessId, sellerId)
		.all<{ status: string; comment: string | null }>();
	return result.results ?? [];
}

describe("PUT /api/leads/[id]", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	it("returns 401 without a seller token", async () => {
		const response = await updateLead(TEST_IDS.businesses.piekarnia, {
			status: "called",
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "brak tokenu" });
	});

	it("returns 401 with an invalid seller token", async () => {
		const response = await updateLead(
			TEST_IDS.businesses.piekarnia,
			{ status: "called" },
			"not-a-real-token",
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "nieprawidlowy token" });
	});

	it("returns 400 for a non-numeric lead id", async () => {
		const response = await updateLead(
			"abc",
			{ status: "called" },
			TEST_IDS.tokens.sellerJan,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "nieprawidlowe ID" });
	});

	it("returns 400 for a status outside the supported enum", async () => {
		const response = await updateLead(
			TEST_IDS.businesses.piekarnia,
			{ status: "bad_status" },
			TEST_IDS.tokens.sellerJan,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "nieprawidlowy status",
			valid: [
				"pending",
				"called",
				"interested",
				"rejected",
				"no_answer",
				"meeting_set",
				"deal_closed",
			],
		});
	});

	it("returns 404 for a nonexistent business id", async () => {
		const response = await updateLead(
			999,
			{ status: "called" },
			TEST_IDS.tokens.sellerJan,
		);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "firma nie istnieje" });
	});

	it("appends a call_log row for the authenticated seller", async () => {
		const businessId = TEST_IDS.businesses.piekarnia;
		const before = await callLogRows(businessId, TEST_IDS.sellers.jan);

		const response = await updateLead(
			businessId,
			{ status: "meeting_set", comment: "wtorek 14:00" },
			TEST_IDS.tokens.sellerJan,
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, status: "meeting_set" });

		const after = await callLogRows(businessId, TEST_IDS.sellers.jan);
		expect(after).toHaveLength(before.length + 1);
		expect(after[0]).toEqual({
			status: "meeting_set",
			comment: "wtorek 14:00",
		});
	});
});
