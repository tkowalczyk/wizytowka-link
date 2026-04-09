import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import type { SiteData } from "../types/site";
import type { RunResult } from "./cron-log";
import {
	type GenerateSitesDeps,
	generateSites,
	runGenerateSites,
} from "./generate-sites";
import type { LLMProvider } from "./site-content";

beforeEach(() => resetDb(env.leadgen));

// -- helpers --

function fakeLLM(): LLMProvider {
	return {
		async complete() {
			return JSON.stringify({
				hero: { headline: "Test headline", subheadline: "Test sub" },
				about: { title: "O nas", text: "Test about" },
				services: [
					{ name: "Usługa A", description: "Opis A" },
					{ name: "Usługa B", description: "Opis B" },
				],
				contact: {
					cta_text: "Zadzwoń",
					phone: "+48100200300",
					address: "ul. Testowa 1",
				},
				seo: { title: "SEO title", description: "SEO description" },
			});
		},
	};
}

function throwingLLM(): LLMProvider {
	return {
		async complete() {
			throw new Error("LLM boom");
		},
	};
}

function fakePutSite() {
	const writes: { key: string; data: SiteData }[] = [];
	const put = async (
		_bucket: R2Bucket,
		_variant: "live" | "draft",
		locSlug: string,
		bizSlug: string,
		data: SiteData,
	) => {
		writes.push({ key: `sites/${locSlug}/${bizSlug}.json`, data });
	};
	return { put, writes };
}

function makeDeps(
	overrides: Partial<GenerateSitesDeps> = {},
): GenerateSitesDeps {
	return {
		db: env.leadgen,
		r2: env.sites,
		llm: fakeLLM(),
		putSite: fakePutSite().put,
		...overrides,
	};
}

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

	it("tracer: claims pending row, marks done after success", async () => {
		// Pre-condition: keep only biz 3 (dentysta-krakow) as pending so we can
		// reason about a single row. Mark biz 6 (mechanik-wroclaw) as done.
		await env.leadgen
			.prepare("UPDATE businesses SET site_status = 'done' WHERE id = 6")
			.run();

		const result = await runGenerateSites(makeDeps(), 5);

		expect(result).toEqual({ processed: 1, failed: 0 });

		const row = await env.leadgen
			.prepare(
				"SELECT site_status, site_claimed_at FROM businesses WHERE id = 3",
			)
			.first<{ site_status: string; site_claimed_at: string | null }>();
		expect(row?.site_status).toBe("done");
		expect(row?.site_claimed_at).toBeNull();
	});

	it("stale claim recovery: in_progress older than 15min returns to pool", async () => {
		// Reduce pool to a single recoverable row.
		await env.leadgen
			.prepare("UPDATE businesses SET site_status = 'done' WHERE id = 6")
			.run();
		// Manually mark biz 3 as 'in_progress' with a stale claim (-20min).
		await env.leadgen
			.prepare(
				"UPDATE businesses SET site_status = 'in_progress', site_claimed_at = datetime('now', '-20 minutes') WHERE id = 3",
			)
			.run();

		const result = await runGenerateSites(makeDeps(), 5);

		expect(result).toEqual({ processed: 1, failed: 0 });
		const row = await env.leadgen
			.prepare(
				"SELECT site_status, site_claimed_at FROM businesses WHERE id = 3",
			)
			.first<{ site_status: string; site_claimed_at: string | null }>();
		expect(row?.site_status).toBe("done");
		expect(row?.site_claimed_at).toBeNull();
	});

	it("does NOT pick up fresh in_progress claims (within TTL)", async () => {
		// Both pending rows go to done so we can isolate biz 3.
		await env.leadgen
			.prepare("UPDATE businesses SET site_status = 'done' WHERE id IN (3, 6)")
			.run();
		// Now mark biz 3 as in_progress with a fresh claim (just now).
		await env.leadgen
			.prepare(
				"UPDATE businesses SET site_status = 'in_progress', site_claimed_at = datetime('now') WHERE id = 3",
			)
			.run();

		const result = await runGenerateSites(makeDeps(), 5);

		expect(result).toEqual({ processed: 0, failed: 0 });
		// Row should remain in_progress untouched.
		const row = await env.leadgen
			.prepare("SELECT site_status FROM businesses WHERE id = 3")
			.first<{ site_status: string }>();
		expect(row?.site_status).toBe("in_progress");
	});

	it("error rollback: failed generation returns row to 'pending'", async () => {
		// Isolate biz 3 as the only candidate.
		await env.leadgen
			.prepare("UPDATE businesses SET site_status = 'done' WHERE id = 6")
			.run();

		const result = await runGenerateSites(makeDeps({ llm: throwingLLM() }), 5);

		expect(result).toEqual({ processed: 0, failed: 1 });
		const row = await env.leadgen
			.prepare(
				"SELECT site_status, site_claimed_at FROM businesses WHERE id = 3",
			)
			.first<{ site_status: string; site_claimed_at: string | null }>();
		expect(row?.site_status).toBe("pending");
		expect(row?.site_claimed_at).toBeNull();
	});

	it("race: parallel runs never claim the same row", async () => {
		// Add a few more pending rows so each parallel run can grab disjoint
		// batches. We start with biz 3 + 6 pending from seed; insert 3 more.
		await env.leadgen
			.prepare(`
        INSERT INTO businesses
        (id, locality_id, place_id, title, slug, phone, address, category, rating, gps_lat, gps_lng, site_status)
        VALUES
        (101, 1, 'race_a', 'Race A', 'race-a', '+48100100100', 'a', 'cat', 4.0, 50.0, 19.0, 'pending'),
        (102, 1, 'race_b', 'Race B', 'race-b', '+48200200200', 'b', 'cat', 4.0, 50.0, 19.0, 'pending'),
        (103, 1, 'race_c', 'Race C', 'race-c', '+48300300300', 'c', 'cat', 4.0, 50.0, 19.0, 'pending')
      `)
			.run();
		// 5 pending rows total. With limit=3 each, two parallel runs should
		// see disjoint sets — total processed = min(2*3, 5) = 5, with no
		// duplicates.

		const [r1, r2] = await Promise.all([
			runGenerateSites(makeDeps(), 3),
			runGenerateSites(makeDeps(), 3),
		]);

		const totalProcessed = r1.processed + r2.processed;
		const totalFailed = r1.failed + r2.failed;
		expect(totalFailed).toBe(0);
		// Each pending row was processed exactly once.
		expect(totalProcessed).toBe(5);

		const remaining = await env.leadgen
			.prepare(
				"SELECT COUNT(*) as cnt FROM businesses WHERE site_status = 'pending'",
			)
			.first<{ cnt: number }>();
		expect(remaining?.cnt).toBe(0);
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
