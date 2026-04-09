import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import type { RunResult } from "./cron-log";
import { generateSites } from "./generate-sites";

beforeEach(() => resetDb(env.leadgen));

describe("generateSites return type", () => {
	it("returns RunResult with zeroes when nothing to generate", async () => {
		// mark all pending businesses as already generated
		await env.leadgen
			.prepare("UPDATE businesses SET site_status = 'done'")
			.run();

		const result: RunResult = await generateSites(env);

		expect(result).toEqual({ processed: 0, failed: 0 });
	});

	it("returns RunResult shape even with candidates present", async () => {
		// candidates exist (biz 3, 6) but we just check the return type is correct
		// by limiting to 0 we get the empty-result path
		const result = await generateSites(env, 0);

		expect(result).toEqual({ processed: 0, failed: 0 });
	});

	it("ignores ineligible rows even when they would match legacy filter", async () => {
		// Biznesy 3 i 6 w seedzie mają site_status='pending' i matchują stary
		// filtr (website NULL, phone NOT NULL). Marking ich jako 'ineligible'
		// powinno je wykluczyć z puli generatora — generator patrzy wyłącznie
		// na site_status, nie dubluje warunków z discovery.
		await env.leadgen
			.prepare(
				"UPDATE businesses SET site_status = 'ineligible', site_ineligible_reason = 'no_phone' WHERE id IN (3, 6)",
			)
			.run();

		const result = await generateSites(env);

		expect(result).toEqual({ processed: 0, failed: 0 });
	});
});
