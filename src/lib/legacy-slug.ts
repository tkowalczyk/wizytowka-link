// Legacy locality slugs from the pre-2026-04-08 era used the `slugify(name)-{7-digit-sym}`
// format. The Phase 2 migration (commits 54f0415, bfe56dd, 30a4ab6) replaced this with a
// hierarchical algorithm whose sym fallback is `name-gmi-pow-woj-{sym}` — multi-segment.
//
// Old URLs Google still has indexed (e.g. /jozefow-0723566) now 404. To deindex them
// faster and cleanly, we return 410 Gone when the path's first segment matches the legacy
// shape AND no current locality has that slug. Current sym-fallback slugs also end in
// `-{7 digits}` but are multi-segment, so they exist in D1 and fall through.

const LEGACY_PATH_RE = /^\/([^/]+-\d{7})(?:\/[^/]+)?$/;

export function extractLegacyLocalitySlug(pathname: string): string | null {
	const m = LEGACY_PATH_RE.exec(pathname);
	return m ? m[1] : null;
}

export async function isLegacyLocalityPath(
	db: D1Database,
	pathname: string,
): Promise<boolean> {
	const slug = extractLegacyLocalitySlug(pathname);
	if (!slug) return false;
	const row = await db
		.prepare("SELECT 1 AS hit FROM localities WHERE slug = ? LIMIT 1")
		.bind(slug)
		.first<{ hit: number }>();
	return row === null;
}

export function goneResponse(): Response {
	const body = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><title>Strona usunięta — wizytowka.link</title><meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 16px;text-align:center;color:#374151"><h1 style="font-size:22px">Strona usunięta</h1><p>Ten adres nie jest już używany. <a href="/" style="color:#2563eb">Wróć na stronę główną</a>.</p></body></html>`;
	return new Response(body, {
		status: 410,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "public, max-age=86400",
		},
	});
}
