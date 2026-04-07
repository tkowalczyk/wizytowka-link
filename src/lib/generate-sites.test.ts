import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import type { RunResult } from "./cron-log";
import { generateSites } from "./generate-sites";

beforeEach(() => resetDb(env.leadgen));

describe("generateSites return type", () => {
	it("returns RunResult with zeroes when nothing to generate", async () => {
		// mark all ungenerated businesses as already generated
		await env.leadgen.prepare("UPDATE businesses SET site_generated = 1").run();

		const result: RunResult = await generateSites(env);

		expect(result).toEqual({ processed: 0, failed: 0 });
	});

	it("returns RunResult shape even with candidates present", async () => {
		// candidates exist (biz 3, 6) but we just check the return type is correct
		// by limiting to 0 we get the empty-result path
		const result = await generateSites(env, 0);

		expect(result).toEqual({ processed: 0, failed: 0 });
	});
});
