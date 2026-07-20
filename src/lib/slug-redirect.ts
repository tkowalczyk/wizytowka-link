// Resolves stale locality-slug URLs to their current canonical form. Locality
// slugs are mutable (the Phase 2 hierarchical-escalation migration renamed most
// of them), so URLs Google indexed under an old slug must 301 to where the
// business actually lives — not 404, 410, or serve a self-canonical noindex
// duplicate (issue #81). Only genuinely-dead legacy URLs return 410.
//
// A `locality_slug_history` row (#83) makes resolution deterministic — it pins an
// old slug to the exact locality it belonged to, even when two same-name
// localities exist. Absent a history row, resolution falls back to the sym in the
// URL and the base-name → escalated-slug relationship (`slugify(name)` is always
// a prefix of the current slug), which stays ambiguous for repeated names.

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

	// 1. Exact current-slug match — a live locality URL. For a business-shaped
	// path, the locality only owns the URL when it has that business row (in any
	// status). This distinction matters when an old bare locality slug was later
	// claimed by a different, empty same-name locality: `/ruszowice/autoserwis`
	// must keep resolving to the unique published `ruszowice-*` sibling, while
	// the bare `/ruszowice` index and withdrawn current businesses stay put.
	const current = await db
		.prepare(
			`SELECT l.id,
			        EXISTS(
			          SELECT 1 FROM businesses b
			          WHERE b.locality_id = l.id AND b.slug = ?
			        ) AS owns_business
			 FROM localities l
			 WHERE l.slug = ? LIMIT 1`,
		)
		.bind(bizSlug ?? "", loc)
		.first<{ id: number; owns_business: number }>();
	if (current && (bizSlug === null || current.owns_business === 1)) {
		return { kind: "pass" };
	}

	// 2. Slug-history match (#83) — authoritative. A recorded old_slug pins the
	// exact locality a URL was published under, so it resolves even the ambiguous
	// same-name case (two "Radzymin") that heuristics below can only return gone
	// for. Checked before heuristics so history always wins.
	const historic = await db
		.prepare(
			`SELECT l.id, l.slug
			 FROM locality_slug_history h
			 JOIN localities l ON l.id = h.locality_id
			 WHERE h.old_slug = ? LIMIT 1`,
		)
		.bind(loc)
		.first<{ id: number; slug: string }>();
	if (historic) return redirectToLocality(db, historic, bizSlug);

	// 3. Legacy `slugify(name)-{7-digit sym}` form: the sym deterministically
	// identifies the current locality.
	const symMatch = SYM_SUFFIX_RE.exec(loc);
	if (symMatch) {
		const locality = await db
			.prepare("SELECT id, slug FROM localities WHERE sym = ? LIMIT 1")
			.bind(symMatch[1])
			.first<{ id: number; slug: string }>();
		if (!locality) return { kind: "gone" };
		return redirectToLocality(db, locality, bizSlug);
	}

	// 4. Candidate match — a bare base name that escalated to a hierarchical slug.
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

// Redirect a URL whose locality was resolved deterministically (by history row
// or by sym): a bare index → the locality's current slug; a business URL → that
// slug only while the business still lives there and is published, else 410.
async function redirectToLocality(
	db: D1Database,
	locality: { id: number; slug: string },
	bizSlug: string | null,
): Promise<StaleUrlResolution> {
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
