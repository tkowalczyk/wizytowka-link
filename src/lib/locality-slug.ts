import { slugify } from "./slug";

export interface LocalityInput {
	name: string;
	gmi_name: string;
	pow_name: string;
	woj_name: string;
	sym: string;
}

export type EscalationLevel = 1 | 2 | 3 | 4 | "sym";

export interface LocalityWithSlug extends LocalityInput {
	slug: string;
	level: EscalationLevel;
}

interface LevelDef {
	level: EscalationLevel;
	build: (loc: LocalityInput) => string;
}

const LEVELS: readonly LevelDef[] = [
	{ level: 1, build: (l) => slugify(l.name) },
	{ level: 2, build: (l) => `${slugify(l.name)}-${slugify(l.gmi_name)}` },
	{
		level: 3,
		build: (l) =>
			`${slugify(l.name)}-${slugify(l.gmi_name)}-${slugify(l.pow_name)}`,
	},
	{
		level: 4,
		build: (l) =>
			`${slugify(l.name)}-${slugify(l.gmi_name)}-${slugify(l.pow_name)}-${slugify(l.woj_name)}`,
	},
];

/**
 * Phase 2 slug algorithm — hierarchical escalation with cross-level guard.
 *
 * For each locality we pick the lowest level whose key is both:
 *   (a) unique among the keys of all rows still pending at that level, AND
 *   (b) not already claimed by a row that settled at a lower level.
 *
 * Levels:
 *   1: name
 *   2: name + gmi
 *   3: name + gmi + pow
 *   4: name + gmi + pow + woj
 * If level 4 still collides (extreme edge case — same name in same gmina,
 * powiat AND wojewodztwo), we append `sym` as a final disambiguator.
 *
 * The cross-level check (b) handles the real-world case where one row's L1
 * key collides with another row's L2 key by string coincidence — e.g.
 * slugify("Kolonia Sejny") === slugify("Kolonia") + "-" + slugify("Sejny").
 *
 * Symmetric: every locality sharing a colliding key gets escalated, not
 * just the second occurrence. Deterministic: depends only on input data,
 * not on iteration order beyond the input array order.
 */
export function assignLocalitySlugs(
	localities: readonly LocalityInput[],
): LocalityWithSlug[] {
	const n = localities.length;
	const chosen: (LocalityWithSlug | null)[] = new Array(n).fill(null);
	const taken = new Set<string>();
	let pending: number[] = localities.map((_, i) => i);

	for (const { level, build } of LEVELS) {
		// Compute this level's key for every pending row + a count multiset.
		const keys = new Map<number, string>();
		const counts = new Map<string, number>();
		for (const i of pending) {
			const k = build(localities[i]);
			keys.set(i, k);
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}

		// A row settles at this level iff its key is unique among pending AND
		// not already taken by a row that settled at an earlier level.
		const stillPending: number[] = [];
		for (const i of pending) {
			const k = keys.get(i) as string;
			if ((counts.get(k) ?? 0) === 1 && !taken.has(k)) {
				chosen[i] = { ...localities[i], slug: k, level };
				taken.add(k);
			} else {
				stillPending.push(i);
			}
		}
		pending = stillPending;
		if (pending.length === 0) break;
	}

	// Final fallback: append sym to the L4 key.
	for (const i of pending) {
		const l4 = LEVELS[LEVELS.length - 1].build(localities[i]);
		const slug = `${l4}-${localities[i].sym}`;
		if (taken.has(slug)) {
			throw new Error(
				`assignLocalitySlugs: sym fallback collision for "${localities[i].name}" ` +
					`(gm. ${localities[i].gmi_name}, pow. ${localities[i].pow_name}, ` +
					`woj. ${localities[i].woj_name}, sym ${localities[i].sym}). ` +
					`Slug "${slug}" already taken.`,
			);
		}
		chosen[i] = { ...localities[i], slug, level: "sym" };
		taken.add(slug);
	}

	return chosen as LocalityWithSlug[];
}
