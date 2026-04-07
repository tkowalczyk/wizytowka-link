import type { APIRoute } from "astro";

interface SitemapRow {
	slug: string;
	loc_slug: string;
	created_at: string;
}

interface LocalityRow {
	slug: string;
}

const DOMAIN = "https://wizytowka.link";

const today = new Date().toISOString().split("T")[0];

const staticPages = [{ loc: "/", priority: "1.0" }];

export const GET: APIRoute = async ({ locals }) => {
	const db = locals.runtime.env.leadgen as D1Database;

	const [localities, rows] = await Promise.all([
		db
			.prepare(`
      SELECT DISTINCT l.slug
      FROM localities l
      INNER JOIN businesses b ON b.locality_id = l.id
      WHERE b.site_generated = 1
      ORDER BY l.slug
    `)
			.all<LocalityRow>(),
		db
			.prepare(`
      SELECT b.slug, l.slug AS loc_slug, b.created_at
      FROM businesses b
      JOIN localities l ON b.locality_id = l.id
      WHERE b.site_generated = 1
      ORDER BY b.created_at DESC
      LIMIT 49000
    `)
			.all<SitemapRow>(),
	]);

	const urls: string[] = [];

	for (const p of staticPages) {
		urls.push(`  <url>
    <loc>${DOMAIN}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${p.priority}</priority>
  </url>`);
	}

	for (const l of localities.results) {
		urls.push(`  <url>
    <loc>${DOMAIN}/${l.slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`);
	}

	for (const r of rows.results) {
		const lastmod = r.created_at.split(" ")[0];
		urls.push(`  <url>
    <loc>${DOMAIN}/${r.loc_slug}/${r.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
	}

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

	return new Response(xml, {
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600, s-maxage=86400",
		},
	});
};
