import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TEST_IDS } from "../../test/seed";
import {
	createDraftPreviewToken,
	invalidateDraftPreviewToken,
	verifyDraftPreviewToken,
} from "./draft-preview";

describe("draft preview tokens", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	it("rejects draft preview access when no token is supplied", async () => {
		await createDraftPreviewToken(
			env.leadgen,
			TEST_IDS.businesses.hydraulikWarszawa,
		);

		const result = await verifyDraftPreviewToken(
			env.leadgen,
			"warszawa",
			"hydraulik-warszawa",
			null,
		);

		expect(result).toBe(false);
	});

	it("accepts a generated token only for its matching business draft", async () => {
		const token = await createDraftPreviewToken(
			env.leadgen,
			TEST_IDS.businesses.hydraulikWarszawa,
		);

		await expect(
			verifyDraftPreviewToken(
				env.leadgen,
				"warszawa",
				"hydraulik-warszawa",
				token,
			),
		).resolves.toBe(true);
		await expect(
			verifyDraftPreviewToken(env.leadgen, "warszawa", "fryzjer-anna", token),
		).resolves.toBe(false);
	});

	it("rejects expired tokens", async () => {
		const token = await createDraftPreviewToken(
			env.leadgen,
			TEST_IDS.businesses.hydraulikWarszawa,
			{
				now: new Date("2026-05-18T10:00:00.000Z"),
				ttlMs: 60_000,
			},
		);

		const result = await verifyDraftPreviewToken(
			env.leadgen,
			"warszawa",
			"hydraulik-warszawa",
			token,
			new Date("2026-05-18T10:02:00.000Z"),
		);

		expect(result).toBe(false);
	});

	it("invalidates a token for a business", async () => {
		const token = await createDraftPreviewToken(
			env.leadgen,
			TEST_IDS.businesses.hydraulikWarszawa,
		);

		await invalidateDraftPreviewToken(
			env.leadgen,
			TEST_IDS.businesses.hydraulikWarszawa,
		);

		await expect(
			verifyDraftPreviewToken(
				env.leadgen,
				"warszawa",
				"hydraulik-warszawa",
				token,
			),
		).resolves.toBe(false);
	});
});
