import type { SiteData } from '../types/site';

interface BusinessRow {
  id: number;
  title: string;
  category: string;
  address: string;
  phone: string;
  rating: number | null;
  slug: string;
  locality_name: string;
  loc_slug: string;
}

interface GLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GLMChoice {
  message: { content: string };
}

interface GLMResponse {
  choices: GLMChoice[];
}

const SYSTEM_PROMPT = `Jestes ekspertem od marketingu lokalnych firm w Polsce. Generujesz tresc strony wizytowkowej w formacie JSON.`;

function buildUserPrompt(biz: BusinessRow): string {
  return `Wygeneruj JSON strony wizytowkowej dla firmy:
- Nazwa: ${biz.title}
- Kategoria: ${biz.category}
- Adres: ${biz.address}
- Telefon: ${biz.phone}
- Ocena Google: ${biz.rating != null ? `${biz.rating}/5` : 'brak'}

Format JSON:
{
  "hero": { "headline": "...", "subheadline": "..." },
  "about": { "title": "...", "text": "..." },
  "services": [{ "name": "...", "description": "..." }],
  "contact": { "cta_text": "...", "phone": "...", "address": "..." },
  "seo": { "title": "...", "description": "..." }
}

Zasady:
- Pisz po polsku, naturalnie, bez marketingowego bullshitu
- 3-5 uslug dopasowanych do kategorii
- SEO title max 60 znakow, description max 155
- Odpowiedz TYLKO JSON, bez markdown`;
}

async function callGLM5(
  messages: GLMMessage[],
  apiKey: string
): Promise<string> {
  const res = await fetch('https://api.z.ai/api/coding/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'glm-5',
      messages,
      temperature: 0.7,
      max_tokens: 6000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GLM-5 ${res.status}: ${text}`);
  }

  const data = (await res.json()) as GLMResponse;
  return data.choices[0].message.content;
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function validateSiteData(raw: string): SiteData {
  const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
  const p = JSON.parse(cleaned) as Record<string, unknown>;

  if (typeof p !== 'object' || p === null) throw new Error('not an object');

  const hero = p.hero as Record<string, unknown> | undefined;
  if (!hero || !isStr(hero.headline) || !isStr(hero.subheadline))
    throw new Error('invalid hero');

  const about = p.about as Record<string, unknown> | undefined;
  if (!about || !isStr(about.title) || !isStr(about.text))
    throw new Error('invalid about');

  const services = p.services;
  if (!Array.isArray(services) || services.length < 1)
    throw new Error('invalid services');
  for (const s of services as Record<string, unknown>[]) {
    if (!isStr(s.name) || !isStr(s.description))
      throw new Error('invalid service item');
  }

  const contact = p.contact as Record<string, unknown> | undefined;
  if (!contact || !isStr(contact.cta_text) || !isStr(contact.phone))
    throw new Error('invalid contact');
  if (!isStr(contact.address)) contact.address = '';

  const seo = p.seo as Record<string, unknown> | undefined;
  if (!seo || !isStr(seo.title) || !isStr(seo.description))
    throw new Error('invalid seo');
  if ((seo.title as string).length > 60) seo.title = (seo.title as string).slice(0, 60);
  if ((seo.description as string).length > 155) seo.description = (seo.description as string).slice(0, 155);

  return {
    hero: hero as unknown as SiteData['hero'],
    about: about as unknown as SiteData['about'],
    services: services as unknown as SiteData['services'],
    contact: contact as unknown as SiteData['contact'],
    seo: seo as unknown as SiteData['seo'],
  };
}

export async function generateSites(env: Env, limit = 10): Promise<void> {
  const { results } = await env.leadgen.prepare(`
    SELECT b.*, l.name as locality_name, l.slug as loc_slug
    FROM businesses b
    JOIN localities l ON b.locality_id = l.id
    WHERE b.website IS NULL AND b.phone IS NOT NULL AND b.site_generated = 0
    LIMIT ?
  `).bind(limit).all<BusinessRow>();

  if (!results?.length) return;

  for (const biz of results) {
    try {
      const messages: GLMMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(biz) },
      ];

      const raw = await callGLM5(messages, env.ZAI_API_KEY);
      const siteData = validateSiteData(raw);

      const key = `sites/${biz.loc_slug}/${biz.slug}.json`;

      await env.sites.put(key, JSON.stringify(siteData), {
        httpMetadata: { contentType: 'application/json' },
      });

      await env.leadgen.prepare(
        `UPDATE businesses SET site_generated = 1 WHERE id = ?`
      ).bind(biz.id).run();

      console.log(`generated: ${key}`);
    } catch (err) {
      console.error(`fail biz ${biz.id}: ${(err as Error).message}`);
    }
  }
}
