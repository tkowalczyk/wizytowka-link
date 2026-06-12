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

function countingThrowingLLM() {
	let calls = 0;
	const llm: LLMProvider = {
		async complete() {
			calls++;
			throw new Error("LLM boom");
		},
	};
	return {
		llm,
		get calls() {
			return calls;
		},
	};
}

function failingTitleLLM(title: string): LLMProvider {
	return {
		async complete(messages) {
			if (messages.some((message) => message.content.includes(title))) {
				throw new Error("LLM boom");
			}
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
	// Issue #54 TDD assumptions:
	// Input: eligible rows are businesses with site_status='pending' or stale
	// in_progress claims; retry metadata lives on the businesses row.
	// Output: failed generation keeps the row pending for a later retry, increments
	// a fail counter, and sets a future retry timestamp.
	// Boundaries: immediate reruns must skip backoff-gated rows; stale in_progress
	// recovery still works; fairness is based on retry state, then stable id order.
	// Not tested here: exact wall-clock cron cadence, Z.ai billing, or production
	// scale performance.

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

	it("error rollback: failed generation records retry backoff", async () => {
		// Isolate biz 3 as the only candidate.
		await env.leadgen
			.prepare("UPDATE businesses SET site_status = 'done' WHERE id = 6")
			.run();

		const result = await runGenerateSites(makeDeps({ llm: throwingLLM() }), 5);

		expect(result).toEqual({ processed: 0, failed: 1 });
		const row = await env.leadgen
			.prepare(
				`SELECT site_status, site_claimed_at, site_fail_count,
                site_retry_after > datetime('now', '+5 minutes') AS backs_off_past_next_cron
         FROM businesses WHERE id = 3`,
			)
			.first<{
				site_status: string;
				site_claimed_at: string | null;
				site_fail_count: number;
				backs_off_past_next_cron: number;
			}>();
		expect(row?.site_status).toBe("pending");
		expect(row?.site_claimed_at).toBeNull();
		expect(row?.site_fail_count).toBe(1);
		expect(row?.backs_off_past_next_cron).toBe(1);
	});

	it("extends backoff for repeated generation failures", async () => {
		// Isolate biz 3 as the only candidate.
		await env.leadgen
			.prepare("UPDATE businesses SET site_status = 'done' WHERE id = 6")
			.run();

		await runGenerateSites(makeDeps({ llm: throwingLLM() }), 5);
		await env.leadgen
			.prepare(
				"UPDATE businesses SET site_retry_after = datetime('now', '-1 minute') WHERE id = 3",
			)
			.run();

		const result = await runGenerateSites(makeDeps({ llm: throwingLLM() }), 5);

		expect(result).toEqual({ processed: 0, failed: 1 });
		const row = await env.leadgen
			.prepare(
				`SELECT site_fail_count,
                site_retry_after > datetime('now', '+59 minutes') AS uses_second_backoff
         FROM businesses WHERE id = 3`,
			)
			.first<{ site_fail_count: number; uses_second_backoff: number }>();
		expect(row?.site_fail_count).toBe(2);
		expect(row?.uses_second_backoff).toBe(1);
	});

	it("clears retry metadata after a retry succeeds", async () => {
		// Isolate biz 3 as a retry-eligible row that previously failed.
		await env.leadgen
			.prepare("UPDATE businesses SET site_status = 'done' WHERE id = 6")
			.run();
		await env.leadgen
			.prepare(
				`UPDATE businesses
         SET site_fail_count = 2,
             site_retry_after = datetime('now', '-1 minute')
         WHERE id = 3`,
			)
			.run();

		const result = await runGenerateSites(makeDeps(), 5);

		expect(result).toEqual({ processed: 1, failed: 0 });
		const row = await env.leadgen
			.prepare(
				"SELECT site_status, site_fail_count, site_retry_after FROM businesses WHERE id = 3",
			)
			.first<{
				site_status: string;
				site_fail_count: number;
				site_retry_after: string | null;
			}>();
		expect(row?.site_status).toBe("done");
		expect(row?.site_fail_count).toBe(0);
		expect(row?.site_retry_after).toBeNull();
	});

	it("does not re-call the LLM for a business that just failed", async () => {
		// Isolate biz 3 as the only candidate.
		await env.leadgen
			.prepare("UPDATE businesses SET site_status = 'done' WHERE id = 6")
			.run();
		const llm = countingThrowingLLM();

		await runGenerateSites(makeDeps({ llm: llm.llm }), 5);
		await runGenerateSites(makeDeps({ llm: llm.llm }), 5);

		expect(llm.calls).toBe(1);
	});

	it("does not let retrying failed rows starve fresh pending businesses", async () => {
		await env.leadgen
			.prepare("UPDATE businesses SET site_status = 'done'")
			.run();
		await env.leadgen
			.prepare(`
				INSERT INTO businesses
				(id, locality_id, place_id, title, slug, phone, address, category, rating, gps_lat, gps_lng, site_status, site_fail_count, site_retry_after)
				VALUES
				(101, 1, 'fail_101', 'Failing Site 101', 'failing-site-101', '+48100100101', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(102, 1, 'fail_102', 'Failing Site 102', 'failing-site-102', '+48100100102', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(103, 1, 'fail_103', 'Failing Site 103', 'failing-site-103', '+48100100103', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(104, 1, 'fail_104', 'Failing Site 104', 'failing-site-104', '+48100100104', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(105, 1, 'fail_105', 'Failing Site 105', 'failing-site-105', '+48100100105', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(106, 1, 'fail_106', 'Failing Site 106', 'failing-site-106', '+48100100106', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(107, 1, 'fail_107', 'Failing Site 107', 'failing-site-107', '+48100100107', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(108, 1, 'fail_108', 'Failing Site 108', 'failing-site-108', '+48100100108', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(109, 1, 'fail_109', 'Failing Site 109', 'failing-site-109', '+48100100109', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(110, 1, 'fail_110', 'Failing Site 110', 'failing-site-110', '+48100100110', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(111, 1, 'fail_111', 'Failing Site 111', 'failing-site-111', '+48100100111', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 1, datetime('now', '-1 minute')),
				(999, 1, 'healthy_999', 'Healthy Site 999', 'healthy-site-999', '+48100999999', 'a', 'cat', 4.0, 50.0, 19.0, 'pending', 0, NULL)
			`)
			.run();

		const result = await runGenerateSites(
			makeDeps({ llm: failingTitleLLM("Failing Site") }),
			10,
		);

		expect(result).toEqual({ processed: 1, failed: 9 });
		const healthy = await env.leadgen
			.prepare("SELECT site_status FROM businesses WHERE id = 999")
			.first<{ site_status: string }>();
		expect(healthy?.site_status).toBe("done");
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
