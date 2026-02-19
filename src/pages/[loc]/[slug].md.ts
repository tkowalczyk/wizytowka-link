import type { APIRoute } from 'astro';
import type { SiteData } from '../../types/site';

function siteToMarkdown(site: SiteData, title: string, url: string): string {
  const lines = [
    `# ${site.hero.headline}`,
    '',
    site.hero.subheadline,
    '',
    `## ${site.about.title}`,
    '',
    site.about.text,
    '',
    '## Uslugi',
    '',
  ];

  for (const s of site.services) {
    lines.push(`### ${s.name}`);
    lines.push('');
    lines.push(s.description);
    lines.push('');
  }

  lines.push('## Kontakt');
  lines.push('');
  lines.push(`- **Adres:** ${site.contact.address}`);
  lines.push(`- **Telefon:** ${site.contact.phone}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`Zrodlo: [${title} — wizytowka.link](${url})`);

  return lines.join('\n');
}

export const GET: APIRoute = async ({ params, locals }) => {
  const { loc, slug } = params;
  if (!loc || !slug) return new Response(null, { status: 404 });

  const r2 = locals.runtime.env.sites as R2Bucket;
  const obj = await r2.get(`sites/${loc}/${slug}.json`);
  if (!obj) return new Response('Not Found', { status: 404 });

  const site = (await obj.json()) as SiteData;

  const db = locals.runtime.env.leadgen as D1Database;
  const biz = await db.prepare(
    `SELECT b.title FROM businesses b JOIN localities l ON b.locality_id = l.id WHERE l.slug = ? AND b.slug = ?`
  ).bind(loc, slug).first<{ title: string }>();

  const title = biz?.title ?? site.hero.headline;
  const canonical = `https://wizytowka.link/${loc}/${slug}`;
  const md = siteToMarkdown(site, title, canonical);

  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      'Link': `<${canonical}>; rel="canonical"`,
    },
  });
};
