import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
	applyR2Rename,
	listAllKeys,
	planR2Rename,
} from "./locality-slug-r2";

describe("planR2Rename — tracer bullet", () => {
	it("plans a single copy operation for one live key whose locality slug changed", () => {
		const ops = planR2Rename({
			liveKeys: ["sites/brzezie-9001/hydraulik-jan.json"],
			draftKeys: [],
			slugMap: new Map([["brzezie-9001", "brzezie-klaj"]]),
		});

		expect(ops).toEqual([
			{
				action: "copy",
				from: "sites/brzezie-9001/hydraulik-jan.json",
				to: "sites/brzezie-klaj/hydraulik-jan.json",
			},
		]);
	});

	it("emits no op when the locality slug is unchanged (already migrated)", () => {
		const ops = planR2Rename({
			liveKeys: ["sites/brzezie-klaj/hydraulik-jan.json"],
			draftKeys: [],
			slugMap: new Map([["brzezie-klaj", "brzezie-klaj"]]),
		});

		expect(ops).toEqual([]);
	});

	it("renames draft keys under sites/draft/ alongside live keys under sites/", () => {
		const ops = planR2Rename({
			liveKeys: ["sites/brzezie-9001/biz-a.json"],
			draftKeys: ["sites/draft/brzezie-9001/biz-b.json"],
			slugMap: new Map([["brzezie-9001", "brzezie-klaj"]]),
		});

		expect(ops).toEqual([
			{
				action: "copy",
				from: "sites/brzezie-9001/biz-a.json",
				to: "sites/brzezie-klaj/biz-a.json",
			},
			{
				action: "copy",
				from: "sites/draft/brzezie-9001/biz-b.json",
				to: "sites/draft/brzezie-klaj/biz-b.json",
			},
		]);
	});

	it("ignores keys that do not match the sites/{loc}/{file}.json pattern without throwing", () => {
		const ops = planR2Rename({
			liveKeys: [
				"sites/foo.txt", // missing locality segment
				"sites/brzezie-9001/nested/deep/file.json", // too many segments
				"other/brzezie-9001/biz.json", // wrong root
				"sites/brzezie-9001/biz.json", // legitimate — must still be planned
			],
			draftKeys: [],
			slugMap: new Map([["brzezie-9001", "brzezie-klaj"]]),
		});

		expect(ops).toEqual([
			{
				action: "copy",
				from: "sites/brzezie-9001/biz.json",
				to: "sites/brzezie-klaj/biz.json",
			},
		]);
	});

	it("emits no op for keys whose locality is not in the slugMap (no entry to migrate)", () => {
		const ops = planR2Rename({
			liveKeys: ["sites/wieliczka/piekarnia.json"],
			draftKeys: [],
			slugMap: new Map(),
		});

		expect(ops).toEqual([]);
	});
});

const PREFIX = "tst-r2-mig"; // namespace under sites/ to avoid colliding with other tests

async function seedObject(key: string, body: string): Promise<void> {
	await env.sites.put(key, body);
}

async function clearPrefix(prefix: string): Promise<void> {
	const all = await listAllKeys(env.sites, prefix);
	for (const k of all) {
		await env.sites.delete(k);
	}
}

describe("applyR2Rename — integration with real R2", () => {
	it("renames live and draft objects, leaves no orphans, and is idempotent + resumable", async () => {
		const livePrefix = `sites/${PREFIX}-live`;
		const draftPrefix = `sites/draft/${PREFIX}-draft`;
		await clearPrefix(livePrefix);
		await clearPrefix(draftPrefix);

		// Seed: two live objects + one draft, all under "old" locality slugs.
		const oldLocLive = `${PREFIX}-live-brzezie-9001`;
		const oldLocDraft = `${PREFIX}-draft-brzezie-9001`;
		const newLocLive = `${PREFIX}-live-brzezie-klaj`;
		const newLocDraft = `${PREFIX}-draft-brzezie-klaj`;

		await seedObject(`sites/${oldLocLive}/biz-a.json`, '{"v":"a"}');
		await seedObject(`sites/${oldLocLive}/biz-b.json`, '{"v":"b"}');
		await seedObject(`sites/draft/${oldLocDraft}/biz-c.json`, '{"v":"c"}');

		const slugMap = new Map([
			[oldLocLive, newLocLive],
			[oldLocDraft, newLocDraft],
		]);

		// First run.
		const liveKeys1 = await listAllKeys(env.sites, "sites/");
		const draftKeys1 = await listAllKeys(env.sites, "sites/draft/");
		// listAllKeys for "sites/" includes draft keys, filter them out.
		const liveOnly1 = liveKeys1.filter((k) => !k.startsWith("sites/draft/"));
		const ops1 = planR2Rename({
			liveKeys: liveOnly1,
			draftKeys: draftKeys1,
			slugMap,
		});
		const r1 = await applyR2Rename(env.sites, ops1);

		expect(r1.copied).toBe(3);
		expect(r1.deleted).toBe(3);
		expect(r1.skipped).toBe(0);

		// New keys exist, old keys gone.
		expect(await env.sites.head(`sites/${newLocLive}/biz-a.json`)).not.toBeNull();
		expect(await env.sites.head(`sites/${newLocLive}/biz-b.json`)).not.toBeNull();
		expect(
			await env.sites.head(`sites/draft/${newLocDraft}/biz-c.json`),
		).not.toBeNull();
		expect(await env.sites.head(`sites/${oldLocLive}/biz-a.json`)).toBeNull();
		expect(await env.sites.head(`sites/${oldLocLive}/biz-b.json`)).toBeNull();
		expect(
			await env.sites.head(`sites/draft/${oldLocDraft}/biz-c.json`),
		).toBeNull();

		// Body preserved.
		const a = await env.sites.get(`sites/${newLocLive}/biz-a.json`);
		expect(await a?.text()).toBe('{"v":"a"}');

		// Second run — idempotent (no source keys remain → nothing to do).
		const liveKeys2 = await listAllKeys(env.sites, "sites/");
		const draftKeys2 = await listAllKeys(env.sites, "sites/draft/");
		const liveOnly2 = liveKeys2.filter((k) => !k.startsWith("sites/draft/"));
		const ops2 = planR2Rename({
			liveKeys: liveOnly2,
			draftKeys: draftKeys2,
			slugMap,
		});
		expect(ops2).toEqual([]);
		const r2 = await applyR2Rename(env.sites, ops2);
		expect(r2.copied).toBe(0);
		expect(r2.deleted).toBe(0);

		// Resume scenario: re-seed an OLD source object (as if migration was
		// interrupted leaving one source still around, target was not yet copied).
		// Restart should finish the migration without losing files.
		await seedObject(`sites/${oldLocLive}/biz-a.json`, '{"v":"a-resume"}');
		// Pretend target doesn't exist yet — delete it to mimic mid-flight crash.
		await env.sites.delete(`sites/${newLocLive}/biz-a.json`);

		const liveKeys3 = await listAllKeys(env.sites, "sites/");
		const draftKeys3 = await listAllKeys(env.sites, "sites/draft/");
		const liveOnly3 = liveKeys3.filter((k) => !k.startsWith("sites/draft/"));
		const ops3 = planR2Rename({
			liveKeys: liveOnly3,
			draftKeys: draftKeys3,
			slugMap,
		});
		const r3 = await applyR2Rename(env.sites, ops3);
		expect(r3.copied + r3.skipped).toBeGreaterThanOrEqual(1);
		expect(
			await env.sites.head(`sites/${newLocLive}/biz-a.json`),
		).not.toBeNull();
		expect(await env.sites.head(`sites/${oldLocLive}/biz-a.json`)).toBeNull();

		// Test skip-target-exists branch: re-seed source AND keep target → apply
		// must skip the copy and still delete the source to converge.
		await seedObject(`sites/${oldLocLive}/biz-a.json`, '{"v":"orphan"}');
		const ops4 = planR2Rename({
			liveKeys: await listAllKeys(env.sites, "sites/").then((ks) =>
				ks.filter((k) => !k.startsWith("sites/draft/")),
			),
			draftKeys: await listAllKeys(env.sites, "sites/draft/"),
			slugMap,
		});
		const r4 = await applyR2Rename(env.sites, ops4);
		expect(r4.skipped).toBeGreaterThanOrEqual(1);
		expect(await env.sites.head(`sites/${oldLocLive}/biz-a.json`)).toBeNull();

		// Cleanup.
		await clearPrefix(`sites/${PREFIX}-live`);
		await clearPrefix(`sites/draft/${PREFIX}-draft`);
	});
});
