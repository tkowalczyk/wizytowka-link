import type { APIRoute } from 'astro';

interface LlmsRow {
  title: string;
  slug: string;
  loc_slug: string;
  category: string;
  address: string;
}

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.leadgen as D1Database;

  const rows = await db.prepare(`
    SELECT b.title, b.slug, l.slug AS loc_slug, b.category, b.address
    FROM businesses b
    JOIN localities l ON b.locality_id = l.id
    WHERE b.site_generated = 1
    ORDER BY l.slug, b.slug
    LIMIT 10000
  `).all<LlmsRow>();

  const lines = [
    '# wizytowka.link',
    '> Wizytowki polskich firm — strony wizytowkowe generowane automatycznie',
    '',
    '## Firmy',
    '',
  ];

  for (const r of rows.results) {
    lines.push(`- [${r.title}](https://wizytowka.link/${r.loc_slug}/${r.slug}.md): ${r.category}, ${r.address}`);
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    },
  });
};
