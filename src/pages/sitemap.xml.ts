import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { slugify } from "../lib/slug";

interface SitemapRow {
	slug: string;
	loc_slug: string;
	created_at: string;
}

interface LocalityRow {
	slug: string;
}

interface CategoryRow {
	loc_slug: string;
	category: string;
}

interface StaticPage {
	loc: string;
	priority: string;
}

interface AssembleSitemapUrlsInput {
	domain: string;
	today: string;
	staticPages: StaticPage[];
	localities: LocalityRow[];
	businesses: SitemapRow[];
	categoryRows: CategoryRow[];
}

const MAX_SITEMAP_URLS = 50_000;

export function buildCategoryUrls(
	rows: CategoryRow[],
	domain: string,
): string[] {
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const row of rows) {
		const catSlug = slugify(row.category);
		const key = `${row.loc_slug}/${catSlug}`;
		if (seen.has(key)) continue;
		seen.add(key);
		urls.push(`  <url>
    <loc>${domain}/${row.loc_slug}/kategoria/${catSlug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`);
	}
	return urls;
}

const DOMAIN = "https://wizytowka.link";

const staticPages = [{ loc: "/", priority: "1.0" }];

export function assembleSitemapUrls({
	domain,
	today,
	staticPages,
	localities,
	businesses,
	categoryRows,
}: AssembleSitemapUrlsInput): string[] {
	const urls: string[] = [];
	const append = (url: string) => {
		if (urls.length < MAX_SITEMAP_URLS) urls.push(url);
	};

	for (const p of staticPages) {
		append(`  <url>
    <loc>${domain}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${p.priority}</priority>
  </url>`);
	}

	for (const l of localities) {
		append(`  <url>
    <loc>${domain}/${l.slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`);
	}

	for (const u of buildCategoryUrls(categoryRows, domain)) {
		append(u);
	}

	for (const r of businesses) {
		const lastmod = r.created_at.split(" ")[0];
		append(`  <url>
    <loc>${domain}/${r.loc_slug}/${r.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
	}

	return urls;
}

export const GET: APIRoute = async () => {
	const db = env.leadgen as D1Database;
	const today = new Date().toISOString().split("T")[0];

	const [localities, rows, categoryRows] = await Promise.all([
		db
			.prepare(`
      SELECT DISTINCT l.slug
      FROM localities l
      INNER JOIN businesses b ON b.locality_id = l.id
      WHERE b.site_status = 'done'
      ORDER BY l.slug
    `)
			.all<LocalityRow>(),
		db
			.prepare(`
      SELECT b.slug, l.slug AS loc_slug, b.created_at
      FROM businesses b
      JOIN localities l ON b.locality_id = l.id
      WHERE b.site_status = 'done'
      ORDER BY b.created_at DESC
      LIMIT 49000
    `)
			.all<SitemapRow>(),
		db
			.prepare(`
      SELECT DISTINCT b.category, l.slug AS loc_slug
      FROM businesses b
      JOIN localities l ON b.locality_id = l.id
      WHERE b.site_status = 'done'
    `)
			.all<CategoryRow>(),
	]);

	const urls = assembleSitemapUrls({
		domain: DOMAIN,
		today,
		staticPages,
		localities: localities.results,
		businesses: rows.results,
		categoryRows: categoryRows.results,
	});

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
