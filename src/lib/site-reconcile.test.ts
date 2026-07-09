import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import { CRON_PATTERNS, runScheduledCron } from "./scheduled";
import { planReconcile, runReconcile } from "./site-reconcile";

function executionContext(): ExecutionContext {
	return {
		waitUntil: () => {},
		passThroughOnException: () => {},
	} as unknown as ExecutionContext;
}

async function listSitesKeys(): Promise<string[]> {
	const out: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await env.sites.list({
			prefix: "sites/",
			cursor,
			limit: 1000,
		});
		for (const o of page.objects) out.push(o.key);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out;
}

async function clearSites(): Promise<void> {
	for (const k of await listSitesKeys()) await env.sites.delete(k);
}

async function bodyOf(key: string): Promise<string | null> {
	const obj = await env.sites.get(key);
	return obj ? obj.text() : null;
}

/** Wipe the seeded business set so a test controls the done-business universe. */
async function clearBusinesses(): Promise<void> {
	await env.leadgen.prepare("DELETE FROM call_log").run();
	await env.leadgen.prepare("DELETE FROM business_owners").run();
	await env.leadgen.prepare("DELETE FROM businesses").run();
}

describe("planReconcile — tracer bullet", () => {
	it("emits no ops and no missing when a done business's expected key is present", () => {
		const plan = planReconcile({
			liveKeys: ["sites/warszawa/hydraulik-jan.json"],
			doneBusinesses: [{ id: 1, slug: "hydraulik-jan", loc_slug: "warszawa" }],
		});

		expect(plan.ops).toEqual([]);
		expect(plan.missing).toEqual([]);
	});
});

describe("planReconcile — stale keys", () => {
	it("moves a stale key to the business's current expected key when the target is absent", () => {
		const plan = planReconcile({
			liveKeys: ["sites/ruszowice/autoserwis.json"],
			doneBusinesses: [
				{ id: 7, slug: "autoserwis", loc_slug: "ruszowice-glogow" },
			],
		});

		expect(plan.ops).toEqual([
			{
				action: "move",
				from: "sites/ruszowice/autoserwis.json",
				to: "sites/ruszowice-glogow/autoserwis.json",
				businessId: 7,
			},
		]);
		// The moved key satisfies the business, so it is not also flagged missing.
		expect(plan.missing).toEqual([]);
	});

	it("deletes a stale key when the business already has an object at its current key", () => {
		const plan = planReconcile({
			liveKeys: [
				"sites/ruszowice-glogow/autoserwis.json", // correct (present)
				"sites/ruszowice/autoserwis.json", // stale duplicate
			],
			doneBusinesses: [
				{ id: 7, slug: "autoserwis", loc_slug: "ruszowice-glogow" },
			],
		});

		expect(plan.ops).toEqual([
			{ action: "delete", key: "sites/ruszowice/autoserwis.json" },
		]);
		expect(plan.missing).toEqual([]);
	});
});

describe("planReconcile — orphan keys", () => {
	it("deletes a key whose business slug matches no done business anywhere", () => {
		const plan = planReconcile({
			liveKeys: ["sites/warszawa/zniknely-biznes.json"],
			doneBusinesses: [{ id: 1, slug: "hydraulik-jan", loc_slug: "warszawa" }],
		});

		expect(plan.ops).toEqual([
			{ action: "delete", key: "sites/warszawa/zniknely-biznes.json" },
		]);
	});

	it("leaves malformed non-site keys untouched instead of deleting them", () => {
		const plan = planReconcile({
			liveKeys: [
				"sites/foo.txt", // no locality segment
				"sites/warszawa/nested/deep.json", // too many segments
			],
			doneBusinesses: [],
		});

		expect(plan.ops).toEqual([]);
	});
});

describe("planReconcile — missing objects", () => {
	it("surfaces a done business that has no live object anywhere and emits no op for it", () => {
		const plan = planReconcile({
			liveKeys: [],
			doneBusinesses: [
				{ id: 4, slug: "piekarnia-pod-bocianem", loc_slug: "krakow" },
			],
		});

		expect(plan.ops).toEqual([]);
		expect(plan.missing).toEqual([
			{ businessId: 4, key: "sites/krakow/piekarnia-pod-bocianem.json" },
		]);
	});
});

describe("runReconcile — integration with real D1 + R2", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
		await clearSites();
		await clearBusinesses();
		// Controlled done-business universe:
		//   101 biz-a @ warszawa (id 2)  — stale R2 object under an old loc slug
		//   102 biz-b @ krakow   (id 1)  — correct R2 object at its current key
		//   103 biz-c @ wroclaw  (id 3)  — no R2 object anywhere (missing)
		await env.leadgen
			.prepare(
				`INSERT INTO businesses
           (id, locality_id, place_id, title, slug, category, gps_lat, gps_lng, site_status)
         VALUES
           (101, 2, 'p_a', 'Biz A', 'biz-a', 'hydraulik', 52.2, 21.0, 'done'),
           (102, 1, 'p_b', 'Biz B', 'biz-b', 'fryzjer', 50.0, 19.9, 'done'),
           (103, 3, 'p_c', 'Biz C', 'biz-c', 'mechanik', 51.1, 17.0, 'done')`,
			)
			.run();
	});

	it("moves stale objects, deletes orphans, leaves correct + draft objects untouched, and regenerates missing", async () => {
		await env.sites.put("sites/warszawa-old/biz-a.json", '{"v":"a"}'); // stale
		await env.sites.put("sites/krakow/biz-b.json", '{"v":"b"}'); // correct
		await env.sites.put("sites/warszawa/orphan.json", '{"v":"orphan"}'); // orphan
		await env.sites.put("sites/draft/warszawa/biz-a.json", '{"v":"draft"}'); // draft

		const result = await runReconcile({ db: env.leadgen, r2: env.sites });

		// Stale object relocated to the current key, body preserved, old key gone.
		expect(await bodyOf("sites/warszawa/biz-a.json")).toBe('{"v":"a"}');
		expect(await env.sites.head("sites/warszawa-old/biz-a.json")).toBeNull();

		// Correct object untouched.
		expect(await bodyOf("sites/krakow/biz-b.json")).toBe('{"v":"b"}');

		// Orphan deleted.
		expect(await env.sites.head("sites/warszawa/orphan.json")).toBeNull();

		// Draft never touched.
		expect(await bodyOf("sites/draft/warszawa/biz-a.json")).toBe(
			'{"v":"draft"}',
		);

		// Missing done business reset so the generate cron regenerates it.
		const bizC = await env.leadgen
			.prepare(
				"SELECT site_status, site_retry_after FROM businesses WHERE id = 103",
			)
			.first<{ site_status: string; site_retry_after: string | null }>();
		expect(bizC?.site_status).toBe("pending");
		expect(bizC?.site_retry_after).toBeNull();

		// RunResult shape + counts.
		expect(result.failed).toBe(0);
		expect(result.meta).toMatchObject({
			moved: 1,
			deleted: 1,
			strays: 2,
			missing: ["sites/wroclaw/biz-c.json"],
		});
		expect(result.processed).toBe(3);
	});

	it("is idempotent — a second invocation reports zero strays", async () => {
		await env.sites.put("sites/warszawa-old/biz-a.json", '{"v":"a"}');
		await env.sites.put("sites/krakow/biz-b.json", '{"v":"b"}');
		await env.sites.put("sites/warszawa/orphan.json", '{"v":"orphan"}');

		await runReconcile({ db: env.leadgen, r2: env.sites });
		const second = await runReconcile({ db: env.leadgen, r2: env.sites });

		expect(second.processed).toBe(0);
		expect(second.failed).toBe(0);
		expect(second.meta).toMatchObject({ strays: 0, moved: 0, deleted: 0 });
	});
});

describe("reconcile cron wiring", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
		await clearSites();
	});

	it("is a registered cron whose run is logged to cron_log", async () => {
		const result = await runScheduledCron(
			env,
			CRON_PATTERNS.reconcile,
			executionContext(),
		);

		expect("error" in result).toBe(false);
		const row = await env.leadgen
			.prepare(
				`SELECT status, items_failed
         FROM cron_log
         WHERE cron_pattern = ?
         ORDER BY id DESC LIMIT 1`,
			)
			.bind(CRON_PATTERNS.reconcile)
			.first<{ status: string; items_failed: number }>();
		expect(row?.status).toBe("completed");
		expect(row?.items_failed).toBe(0);
	});
});
