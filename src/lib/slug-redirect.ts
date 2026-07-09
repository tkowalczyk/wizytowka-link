// Resolves stale locality-slug URLs to their current canonical form. Locality
// slugs are mutable (the Phase 2 hierarchical-escalation migration renamed most
// of them), so URLs Google indexed under an old slug must 301 to where the
// business actually lives — not 404, 410, or serve a self-canonical noindex
// duplicate (issue #81). Only genuinely-dead legacy URLs return 410.
//
// #83 (slug history) will make this deterministic; until then this works against
// production data as-is via the sym in the URL and the base-name → escalated-slug
// relationship (`slugify(name)` is always a prefix of the current slug).

export type StaleUrlResolution =
	| { kind: "redirect"; location: string }
	| { kind: "gone" }
	| { kind: "pass" };

const SLUG_RE = /^[a-z0-9-]+$/;
const SYM_SUFFIX_RE = /-(\d{7})$/;

export async function resolveStaleLocalityUrl(
	db: D1Database,
	pathname: string,
): Promise<StaleUrlResolution> {
	const segments = pathname.split("/").filter(Boolean);
	if (segments.length < 1 || segments.length > 2) return { kind: "pass" };

	const loc = segments[0];
	const bizSlug = segments[1] ?? null;

	// Only locality/business-shaped segments can be stale slugs; static files
	// (robots.txt, sitemap.xml) and api paths pass straight through.
	if (!SLUG_RE.test(loc)) return { kind: "pass" };
	if (bizSlug !== null && !SLUG_RE.test(bizSlug)) return { kind: "pass" };

	// 1. Exact current-slug match — a live URL. Guarded before candidate matching
	// so a current slug with escalated siblings (`krakow` next to `krakow-xxx`)
	// is never mistaken for a stale base name.
	const current = await db
		.prepare("SELECT 1 AS hit FROM localities WHERE slug = ? LIMIT 1")
		.bind(loc)
		.first<{ hit: number }>();
	if (current) return { kind: "pass" };

	// 2. Legacy `slugify(name)-{7-digit sym}` form: the sym deterministically
	// identifies the current locality.
	const symMatch = SYM_SUFFIX_RE.exec(loc);
	if (symMatch) {
		const locality = await db
			.prepare("SELECT id, slug FROM localities WHERE sym = ? LIMIT 1")
			.bind(symMatch[1])
			.first<{ id: number; slug: string }>();
		if (!locality) return { kind: "gone" };
		if (bizSlug === null) {
			return { kind: "redirect", location: `/${locality.slug}` };
		}
		const biz = await db
			.prepare(
				"SELECT 1 AS hit FROM businesses WHERE locality_id = ? AND slug = ? AND site_status = 'done' LIMIT 1",
			)
			.bind(locality.id, bizSlug)
			.first<{ hit: number }>();
		return biz
			? { kind: "redirect", location: `/${locality.slug}/${bizSlug}` }
			: { kind: "gone" };
	}

	// 3. Candidate match — a bare base name that escalated to a hierarchical slug.
	// `slugify(name)` is always a prefix of the current slug, so the candidates
	// are the current localities whose slug is `${loc}-…`.
	if (bizSlug !== null) {
		const { results } = await db
			.prepare(
				`SELECT DISTINCT l.slug AS slug
				 FROM localities l
				 JOIN businesses b ON b.locality_id = l.id
				 WHERE l.slug LIKE ? AND b.slug = ? AND b.site_status = 'done'
				 LIMIT 2`,
			)
			.bind(`${loc}-%`, bizSlug)
			.all<{ slug: string }>();
		if (results.length === 1) {
			return { kind: "redirect", location: `/${results[0].slug}/${bizSlug}` };
		}
		if (results.length > 1) return { kind: "gone" }; // ambiguous base name
		// No done business under this base. Distinguish a real-but-withdrawn stale
		// slug (410) from an unknown path (let it 404 normally).
		return baseNameExists(db, loc);
	}

	// Bare locality index: redirect only when the base maps to exactly one
	// escalated slug; ambiguity can't be resolved without a business to
	// disambiguate, and an unknown base is a normal 404.
	const { results } = await db
		.prepare("SELECT slug FROM localities WHERE slug LIKE ? LIMIT 2")
		.bind(`${loc}-%`)
		.all<{ slug: string }>();
	if (results.length === 1) {
		return { kind: "redirect", location: `/${results[0].slug}` };
	}
	if (results.length > 1) return { kind: "gone" };
	return { kind: "pass" };
}

// A stale base name that maps to a real escalated locality is a withdrawal → 410;
// an unknown segment is a normal 404 and must pass through untouched.
async function baseNameExists(
	db: D1Database,
	loc: string,
): Promise<StaleUrlResolution> {
	const candidate = await db
		.prepare("SELECT 1 AS hit FROM localities WHERE slug LIKE ? LIMIT 1")
		.bind(`${loc}-%`)
		.first<{ hit: number }>();
	return candidate ? { kind: "gone" } : { kind: "pass" };
}
