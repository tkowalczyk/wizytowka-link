import { assignLocalitySlugs } from "../locality-slug";

export interface LocalityRow {
	id: number;
	current_slug: string;
	name: string;
	gmi_name: string;
	pow_name: string;
	woj_name: string;
	sym: string;
}

export interface SlugUpdate {
	id: number;
	new_slug: string;
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
			"SELECT id, slug AS current_slug, name, gmi_name, pow_name, woj_name, sym FROM localities ORDER BY id",
		)
		.all<LocalityRow>();
	return results;
}

export interface ApplyResult {
	applied: number;
	batches: number;
}

export async function applyD1Migration(
	db: D1Database,
	plan: MigrationPlan,
): Promise<ApplyResult> {
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
		})),
	);
	const updates: SlugUpdate[] = [];
	let unchangedCount = 0;
	for (let i = 0; i < rows.length; i++) {
		if (rows[i].current_slug === withSlugs[i].slug) {
			unchangedCount++;
		} else {
			updates.push({ id: rows[i].id, new_slug: withSlugs[i].slug });
		}
	}
	return { updates, unchangedCount };
}
