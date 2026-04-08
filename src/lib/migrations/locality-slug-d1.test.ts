import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../test/seed";
import {
	applyD1Migration,
	batchD1Updates,
	loadLocalityRows,
	planD1Migration,
} from "./locality-slug-d1";

describe("planD1Migration — tracer bullet", () => {
	it("plans a single UPDATE for a row whose old sym-suffixed slug differs from the new algorithm slug", () => {
		const rows = [
			{
				id: 42,
				current_slug: "brzezie-1234567",
				name: "Brzezie",
				gmi_name: "Kłaj",
				pow_name: "wielicki",
				woj_name: "małopolskie",
				sym: "1234567",
			},
		];

		const plan = planD1Migration(rows);

		expect(plan.unchangedCount).toBe(0);
		expect(plan.updates).toEqual([{ id: 42, new_slug: "brzezie" }]);
	});

	it("treats a row whose current slug already matches the algorithm output as unchanged", () => {
		const plan = planD1Migration([
			{
				id: 7,
				current_slug: "brzezie",
				name: "Brzezie",
				gmi_name: "Kłaj",
				pow_name: "wielicki",
				woj_name: "małopolskie",
				sym: "1234567",
			},
		]);

		expect(plan.updates).toEqual([]);
		expect(plan.unchangedCount).toBe(1);
	});

	it("only updates rows whose computed slug differs, including escalations from L1 collisions", () => {
		// Two "Brzezie" collide → both must escalate to L2 (brzezie-klaj, brzezie-mosina).
		// One unique "Wieliczka" stays at L1 and is already at the new value.
		// All three currently sit on the legacy "-{sym}" suffix, except Wieliczka.
		const plan = planD1Migration([
			{
				id: 1,
				current_slug: "brzezie-1001",
				name: "Brzezie",
				gmi_name: "Kłaj",
				pow_name: "wielicki",
				woj_name: "małopolskie",
				sym: "1001",
			},
			{
				id: 2,
				current_slug: "brzezie-2002",
				name: "Brzezie",
				gmi_name: "Mosina",
				pow_name: "poznański",
				woj_name: "wielkopolskie",
				sym: "2002",
			},
			{
				id: 3,
				current_slug: "wieliczka",
				name: "Wieliczka",
				gmi_name: "Wieliczka",
				pow_name: "wielicki",
				woj_name: "małopolskie",
				sym: "3003",
			},
		]);

		expect(plan.unchangedCount).toBe(1);
		expect(plan.updates).toEqual([
			{ id: 1, new_slug: "brzezie-klaj" },
			{ id: 2, new_slug: "brzezie-mosina" },
		]);
	});
});

describe("batchD1Updates — D1 100-param limit", () => {
	it("emits a single batch with CASE WHEN SQL and bound params for a small update set", () => {
		const batches = batchD1Updates([
			{ id: 1, new_slug: "brzezie-klaj" },
			{ id: 2, new_slug: "brzezie-mosina" },
		]);

		expect(batches).toHaveLength(1);
		const [b] = batches;
		expect(b.sql).toBe(
			"UPDATE localities SET slug = CASE id WHEN ?1 THEN ?2 WHEN ?3 THEN ?4 END WHERE id IN (?5,?6)",
		);
		expect(b.params).toEqual([1, "brzezie-klaj", 2, "brzezie-mosina", 1, 2]);
	});

	it("splits updates into multiple batches so no batch exceeds the 100-param D1 ceiling", () => {
		const updates = Array.from({ length: 70 }, (_, i) => ({
			id: i + 1,
			new_slug: `slug-${i + 1}`,
		}));

		const batches = batchD1Updates(updates);

		// 3 params per row → max 33 rows per batch → 70 rows → at least 3 batches
		expect(batches.length).toBeGreaterThanOrEqual(3);
		for (const b of batches) {
			expect(b.params.length).toBeLessThanOrEqual(100);
		}
		// All rows accounted for, no duplicates.
		const seen = new Set<number>();
		for (const b of batches) {
			const idsInBatch = b.params.filter(
				(p): p is number => typeof p === "number",
			);
			// Each id appears twice in params (CASE WHEN + IN list).
			const unique = new Set(idsInBatch);
			for (const id of unique) seen.add(id);
		}
		expect(seen.size).toBe(70);
	});

	it("returns empty batch list for empty updates", () => {
		expect(batchD1Updates([])).toEqual([]);
	});
});

describe("applyD1Migration — integration with real D1", () => {
	beforeEach(() => resetDb(env.leadgen));

	it("rewrites legacy sym-suffixed slugs to the new algorithm slugs and is idempotent on second run", async () => {
		// Inject two colliding "Brzezie" rows with legacy "-{sym}" slugs.
		await env.leadgen
			.prepare(
				`INSERT INTO localities (name, slug, sym, sym_pod, woj, woj_name, pow, pow_name, gmi, gmi_name)
				 VALUES
				   ('Brzezie','brzezie-9001','9001','9001','12','małopolskie','12-15','wielicki','12-15-03','Kłaj'),
				   ('Brzezie','brzezie-9002','9002','9002','30','wielkopolskie','30-21','poznański','30-21-04','Mosina')`,
			)
			.run();

		// Snapshot row counts of unrelated tables — must be unchanged after migration.
		const beforeBiz = await env.leadgen
			.prepare("SELECT COUNT(*) AS c FROM businesses")
			.first<{ c: number }>();
		const beforeOwners = await env.leadgen
			.prepare("SELECT COUNT(*) AS c FROM business_owners")
			.first<{ c: number }>();
		const beforeSellers = await env.leadgen
			.prepare("SELECT COUNT(*) AS c FROM sellers")
			.first<{ c: number }>();
		const beforeCallLog = await env.leadgen
			.prepare("SELECT COUNT(*) AS c FROM call_log")
			.first<{ c: number }>();

		// Run #1
		const rowsBefore = await loadLocalityRows(env.leadgen);
		const plan1 = planD1Migration(rowsBefore);
		const result1 = await applyD1Migration(env.leadgen, plan1);

		expect(result1.applied).toBe(plan1.updates.length);
		expect(plan1.updates.length).toBeGreaterThanOrEqual(2);

		const brzezieKlaj = await env.leadgen
			.prepare("SELECT slug FROM localities WHERE sym = '9001'")
			.first<{ slug: string }>();
		const brzezieMosina = await env.leadgen
			.prepare("SELECT slug FROM localities WHERE sym = '9002'")
			.first<{ slug: string }>();

		expect(brzezieKlaj?.slug).toBe("brzezie-klaj");
		expect(brzezieMosina?.slug).toBe("brzezie-mosina");

		// Run #2 — must be a no-op.
		const rowsAfter = await loadLocalityRows(env.leadgen);
		const plan2 = planD1Migration(rowsAfter);
		const result2 = await applyD1Migration(env.leadgen, plan2);

		expect(plan2.updates).toEqual([]);
		expect(result2.applied).toBe(0);
		expect(plan2.unchangedCount).toBe(rowsAfter.length);

		// Regression: businesses/owners/sellers/call_log untouched.
		const afterBiz = await env.leadgen
			.prepare("SELECT COUNT(*) AS c FROM businesses")
			.first<{ c: number }>();
		const afterOwners = await env.leadgen
			.prepare("SELECT COUNT(*) AS c FROM business_owners")
			.first<{ c: number }>();
		const afterSellers = await env.leadgen
			.prepare("SELECT COUNT(*) AS c FROM sellers")
			.first<{ c: number }>();
		const afterCallLog = await env.leadgen
			.prepare("SELECT COUNT(*) AS c FROM call_log")
			.first<{ c: number }>();

		expect(afterBiz?.c).toBe(beforeBiz?.c);
		expect(afterOwners?.c).toBe(beforeOwners?.c);
		expect(afterSellers?.c).toBe(beforeSellers?.c);
		expect(afterCallLog?.c).toBe(beforeCallLog?.c);
	});
});
