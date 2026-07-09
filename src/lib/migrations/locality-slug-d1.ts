import { assignLocalitySlugs } from "../locality-slug";

export interface LocalityRow {
	id: number;
	current_slug: string;
	name: string;
	gmi_name: string;
	pow_name: string;
	woj_name: string;
	sym: string;
	/**
	 * 1 when the locality has any `done` business, i.e. is published and indexed.
	 * Such rows keep their current slug across recomputation (#83). Absent on
	 * hand-built rows → treated as unfrozen.
	 */
	frozen?: number;
}

export interface SlugUpdate {
	id: number;
	new_slug: string;
	/** The slug being replaced — recorded in locality_slug_history (#83). */
	old_slug: string;
}

export interface MigrationPlan {
	updates: SlugUpdate[];
	unchangedCount: number;
}

export interface D1Batch {
	sql: string;
	params: (number | string)[];
}

// 3 params per row (CASE WHEN id, slug literal, IN-list id) → 33 rows = 99 params,
// safely under D1's 100-param ceiling.
const MAX_ROWS_PER_BATCH = 33;

export function batchD1Updates(updates: readonly SlugUpdate[]): D1Batch[] {
	if (updates.length === 0) return [];
	const batches: D1Batch[] = [];
	for (let i = 0; i < updates.length; i += MAX_ROWS_PER_BATCH) {
		const slice = updates.slice(i, i + MAX_ROWS_PER_BATCH);
		const params: (number | string)[] = [];
		const whenClauses: string[] = [];
		const inPlaceholders: string[] = [];
		// CASE WHEN id ?n THEN ?n+1 ...
		for (const u of slice) {
			params.push(u.id);
			const idIdx = params.length;
			params.push(u.new_slug);
			const slugIdx = params.length;
			whenClauses.push(`WHEN ?${idIdx} THEN ?${slugIdx}`);
		}
		for (const u of slice) {
			params.push(u.id);
			inPlaceholders.push(`?${params.length}`);
		}
		const sql = `UPDATE localities SET slug = CASE id ${whenClauses.join(" ")} END WHERE id IN (${inPlaceholders.join(",")})`;
		batches.push({ sql, params });
	}
	return batches;
}

export async function loadLocalityRows(
	db: D1Database,
): Promise<LocalityRow[]> {
	const { results } = await db
		.prepare(
			`SELECT l.id, l.slug AS current_slug, l.name, l.gmi_name, l.pow_name,
			        l.woj_name, l.sym,
			        EXISTS(
			          SELECT 1 FROM businesses b
			          WHERE b.locality_id = l.id AND b.site_status = 'done'
			        ) AS frozen
			 FROM localities l ORDER BY l.id`,
		)
		.all<LocalityRow>();
	return results;
}

// 2 params per row (old_slug, locality_id) → 50 rows = 100 params, at D1's ceiling.
const MAX_HISTORY_ROWS_PER_BATCH = 50;

/**
 * INSERT OR IGNORE batches recording each replaced slug in locality_slug_history.
 * OR IGNORE makes re-running the migration a no-op once an old_slug is recorded.
 */
export function batchHistoryInserts(updates: readonly SlugUpdate[]): D1Batch[] {
	if (updates.length === 0) return [];
	const batches: D1Batch[] = [];
	for (let i = 0; i < updates.length; i += MAX_HISTORY_ROWS_PER_BATCH) {
		const slice = updates.slice(i, i + MAX_HISTORY_ROWS_PER_BATCH);
		const params: (number | string)[] = [];
		const valuePlaceholders: string[] = [];
		for (const u of slice) {
			params.push(u.old_slug);
			const oldIdx = params.length;
			params.push(u.id);
			valuePlaceholders.push(`(?${oldIdx}, ?${params.length})`);
		}
		const sql = `INSERT OR IGNORE INTO locality_slug_history (old_slug, locality_id) VALUES ${valuePlaceholders.join(", ")}`;
		batches.push({ sql, params });
	}
	return batches;
}

export interface ApplyResult {
	applied: number;
	batches: number;
}

export async function applyD1Migration(
	db: D1Database,
	plan: MigrationPlan,
): Promise<ApplyResult> {
	// Record history BEFORE rewriting slugs so a crash mid-migration never loses
	// the old→new mapping; OR IGNORE keeps it idempotent regardless of order.
	for (const b of batchHistoryInserts(plan.updates)) {
		await db
			.prepare(b.sql)
			.bind(...b.params)
			.run();
	}
	const batches = batchD1Updates(plan.updates);
	for (const b of batches) {
		await db
			.prepare(b.sql)
			.bind(...b.params)
			.run();
	}
	return { applied: plan.updates.length, batches: batches.length };
}

export function planD1Migration(rows: readonly LocalityRow[]): MigrationPlan {
	const withSlugs = assignLocalitySlugs(
		rows.map((r) => ({
			name: r.name,
			gmi_name: r.gmi_name,
			pow_name: r.pow_name,
			woj_name: r.woj_name,
			sym: r.sym,
			// Published localities (a `done` business) keep their slug — pin it so
			// a later collider escalates around them instead of rebasing them (#83).
			frozenSlug: r.frozen ? r.current_slug : undefined,
		})),
	);
	const updates: SlugUpdate[] = [];
	let unchangedCount = 0;
	for (let i = 0; i < rows.length; i++) {
		if (rows[i].current_slug === withSlugs[i].slug) {
			unchangedCount++;
		} else {
			updates.push({
				id: rows[i].id,
				new_slug: withSlugs[i].slug,
				old_slug: rows[i].current_slug,
			});
		}
	}
	return { updates, unchangedCount };
}
