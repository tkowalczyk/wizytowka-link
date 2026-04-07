import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TEST_IDS } from "../../../test/seed";
import { findOwnerByChatId, getBusinessSlugs } from "./queries";

describe("telegram queries", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	describe("findOwnerByChatId", () => {
		it("returns owner for known chat_id", async () => {
			const owner = await findOwnerByChatId(env.leadgen, "200001");
			expect(owner).not.toBeNull();
			expect(owner?.business_id).toBe(TEST_IDS.businesses.hydraulikWarszawa);
		});

		it("returns null for unknown chat_id", async () => {
			const owner = await findOwnerByChatId(env.leadgen, "999999");
			expect(owner).toBeNull();
		});
	});

	describe("getBusinessSlugs", () => {
		it("returns slugs for known business", async () => {
			const slugs = await getBusinessSlugs(
				env.leadgen,
				TEST_IDS.businesses.hydraulikWarszawa,
			);
			expect(slugs).toEqual({
				bizSlug: "hydraulik-warszawa",
				locSlug: "warszawa",
			});
		});

		it("returns null for unknown business", async () => {
			const slugs = await getBusinessSlugs(env.leadgen, 99999);
			expect(slugs).toBeNull();
		});
	});
});
