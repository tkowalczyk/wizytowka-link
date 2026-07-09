import type { RunResult } from "./cron-log";
import { siteKey } from "./site-store";

export interface DoneBusiness {
	id: number;
	slug: string;
	loc_slug: string;
}

export type ReconcileOp =
	| { action: "move"; from: string; to: string; businessId: number }
	| { action: "delete"; key: string };

export interface MissingSite {
	businessId: number;
	key: string;
}

export interface ReconcilePlan {
	ops: ReconcileOp[];
	missing: MissingSite[];
}

export interface PlanReconcileInput {
	liveKeys: readonly string[];
	doneBusinesses: readonly DoneBusiness[];
}

const LIVE_RE = /^sites\/([^/]+)\/([^/]+)\.json$/;

export function planReconcile(input: PlanReconcileInput): ReconcilePlan {
	const expectedKeys = new Set<string>();
	const bySlug = new Map<string, DoneBusiness[]>();
	for (const b of input.doneBusinesses) {
		expectedKeys.add(siteKey("live", b.loc_slug, b.slug));
		const group = bySlug.get(b.slug);
		if (group) group.push(b);
		else bySlug.set(b.slug, [b]);
	}

	// Keys already sitting at a business's current expected location — correct.
	const present = new Set(input.liveKeys.filter((k) => expectedKeys.has(k)));

	const ops: ReconcileOp[] = [];
	for (const key of input.liveKeys) {
		if (expectedKeys.has(key)) continue; // correct → untouched
		const m = LIVE_RE.exec(key);
		if (!m) continue; // malformed / non-site key → leave untouched
		const bizSlug = m[2];
		// A stray belongs to a same-slug done business that is still missing its
		// object at the current expected key.
		const target = bySlug
			.get(bizSlug)
			?.find((b) => !present.has(siteKey("live", b.loc_slug, b.slug)));
		if (target) {
			const to = siteKey("live", target.loc_slug, target.slug);
			ops.push({ action: "move", from: key, to, businessId: target.id });
			present.add(to);
		} else {
			// No done business needs this object (orphan, or a redundant duplicate
			// of a business already present at its current key) → remove it.
			ops.push({ action: "delete", key });
		}
	}

	const missing: MissingSite[] = [];
	for (const b of input.doneBusinesses) {
		const key = siteKey("live", b.loc_slug, b.slug);
		if (!present.has(key)) missing.push({ businessId: b.id, key });
	}
	return { ops, missing };
}

export interface ReconcileDeps {
	db: D1Database;
	r2: R2Bucket;
}

const DRAFT_PREFIX = "sites/draft/";

/** All live site keys (paged), excluding the draft namespace. */
async function listLiveKeys(r2: R2Bucket): Promise<string[]> {
	const out: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await r2.list({ prefix: "sites/", cursor, limit: 1000 });
		for (const obj of page.objects) {
			if (!obj.key.startsWith(DRAFT_PREFIX)) out.push(obj.key);
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out;
}

/**
 * Every `done` business with its current locality slug. Loaded whole (no
 * per-key `IN(...)` lookup) because missing-object detection already needs the
 * full done set — so the D1 100-param bind limit never comes into play.
 */
async function loadDoneBusinesses(db: D1Database): Promise<DoneBusiness[]> {
	const { results } = await db
		.prepare(
			`SELECT b.id AS id, b.slug AS slug, l.slug AS loc_slug
       FROM businesses b
       JOIN localities l ON b.locality_id = l.id
       WHERE b.site_status = 'done'
       ORDER BY b.id`,
		)
		.all<DoneBusiness>();
	return results;
}

/**
 * Reconciles live R2 site objects against D1: relocates stale objects to each
 * business's current key, deletes orphans, and resets `done` businesses that
 * have no live object so the `generate` cron regenerates them. Draft objects
 * are never touched.
 */
export async function runReconcile(deps: ReconcileDeps): Promise<RunResult> {
	const { db, r2 } = deps;
	const liveKeys = await listLiveKeys(r2);
	const doneBusinesses = await loadDoneBusinesses(db);
	const plan = planReconcile({ liveKeys, doneBusinesses });

	let moved = 0;
	let deleted = 0;
	let failed = 0;

	for (const op of plan.ops) {
		try {
			if (op.action === "move") {
				// Preserve the object at the current key. If the target already
				// exists (e.g. a concurrent generate run filled it), just drop the
				// stale source so the reconcile still converges.
				const targetExists = (await r2.head(op.to)) !== null;
				if (!targetExists) {
					const src = await r2.get(op.from);
					if (src) {
						await r2.put(op.to, src.body, { httpMetadata: src.httpMetadata });
					}
				}
				await r2.delete(op.from);
				moved++;
			} else {
				await r2.delete(op.key);
				deleted++;
			}
		} catch (err) {
			console.error("reconcile op failed:", err);
			failed++;
		}
	}

	for (const m of plan.missing) {
		try {
			await db
				.prepare(
					`UPDATE businesses
           SET site_status = 'pending',
               site_claimed_at = NULL,
               site_retry_after = NULL,
               site_fail_count = 0
           WHERE id = ?`,
				)
				.bind(m.businessId)
				.run();
		} catch (err) {
			console.error(
				`reconcile missing reset failed (biz ${m.businessId}):`,
				err,
			);
			failed++;
		}
	}

	const strays = moved + deleted;
	return {
		processed: strays + plan.missing.length,
		failed,
		meta: {
			scanned: liveKeys.length,
			moved,
			deleted,
			strays,
			missing: plan.missing.map((m) => m.key),
		},
	};
}

export async function reconcileSites(env: Env): Promise<RunResult> {
	return runReconcile({ db: env.leadgen, r2: env.sites });
}
