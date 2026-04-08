import { slugify } from "./slug";

export interface LocalityInput {
	name: string;
	gmi_name: string;
	pow_name: string;
	woj_name: string;
	sym: string;
}

export interface LocalityWithSlug extends LocalityInput {
	slug: string;
}

/**
 * Phase 1 slug algorithm (tracer bullet):
 * - Unique name → bare slug(name)
 * - Name collides with another locality → slug(name)-slug(gmi_name)
 *   Applied symmetrically to ALL colliding rows (not just 2nd+).
 *
 * Throws when the resulting slug set is not unique (e.g. two localities
 * of the same name within the same gmina — unresolvable at level 1).
 */
export function assignLocalitySlugs(
	localities: readonly LocalityInput[],
): LocalityWithSlug[] {
	const nameCounts = new Map<string, number>();
	for (const loc of localities) {
		const key = slugify(loc.name);
		nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
	}

	const result: LocalityWithSlug[] = localities.map((loc) => {
		const base = slugify(loc.name);
		const slug =
			(nameCounts.get(base) ?? 0) > 1
				? `${base}-${slugify(loc.gmi_name)}`
				: base;
		return { ...loc, slug };
	});

	const seen = new Map<string, LocalityWithSlug>();
	for (const loc of result) {
		const existing = seen.get(loc.slug);
		if (existing) {
			throw new Error(
				`assignLocalitySlugs: duplicate slug "${loc.slug}" — ` +
					`"${existing.name}" (gm. ${existing.gmi_name}, pow. ${existing.pow_name}) ` +
					`vs "${loc.name}" (gm. ${loc.gmi_name}, pow. ${loc.pow_name}). ` +
					`Phase 1 cannot resolve collisions within the same gmina.`,
			);
		}
		seen.set(loc.slug, loc);
	}

	return result;
}
