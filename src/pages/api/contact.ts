import type { APIRoute } from 'astro';
import { sendMessage } from '../../lib/telegram';
import type { SellerRow } from '../../types/business';
import { generateOwnerToken } from '../../lib/token';

interface ContactBody {
  phone: string;
  token: string;
}

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

interface MatchRow {
  id: number;
  title: string;
  category: string;
  slug: string;
  locality_name: string;
  locality_slug: string;
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizePhone(raw: string): string | null {
  const stripped = raw.replace(/\s+/g, '');
  if (/^\+48\d{9}$/.test(stripped)) return stripped;
  if (/^\d{9}$/.test(stripped)) return `+48${stripped}`;
  if (/^48\d{9}$/.test(stripped)) return `+${stripped}`;
  return null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let body: ContactBody;
  try {
    body = await request.json() as ContactBody;
  } catch {
    return json({ error: 'nieprawidlowe dane' }, 400);
  }

  const phone = normalizePhone(body.phone ?? '');
  if (!phone) return json({ error: 'nieprawidlowy numer telefonu' }, 400);

  // Turnstile verification
  const turnstileRes = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: body.token,
      }),
    }
  );
  const turnstile = await turnstileRes.json() as TurnstileResponse;
  if (!turnstile.success) {
    return json({ error: 'weryfikacja nieudana' }, 403);
  }

  // Match businesses by phone
  const matches = await env.leadgen.prepare(`
    SELECT b.id, b.title, b.category, b.slug, l.name as locality_name, l.slug as locality_slug
    FROM businesses b
    JOIN localities l ON b.locality_id = l.id
    WHERE REPLACE(REPLACE(REPLACE(b.phone, ' ', ''), '-', ''), '+48', '') = ?
  `).bind(phone.replace('+48', '')).all<MatchRow>();

  let matchBlock: string;

  if (matches.results.length > 0) {
    const lines: string[] = [];
    lines.push(`Pasujace firmy: ${matches.results.length}`);

    for (let i = 0; i < matches.results.length; i++) {
      const m = matches.results[i];

      // Check/create business_owners entry
      const existing = await env.leadgen.prepare(
        'SELECT token FROM business_owners WHERE business_id = ?'
      ).bind(m.id).first<{ token: string }>();

      let ownerToken: string;
      if (existing) {
        ownerToken = existing.token;
      } else {
        ownerToken = generateOwnerToken();
        await env.leadgen.prepare(
          'INSERT INTO business_owners (business_id, token) VALUES (?, ?)'
        ).bind(m.id, ownerToken).run();
      }

      // Check if site exists in R2
      const siteKey = `sites/${m.locality_slug}/${m.slug}.json`;
      const siteObj = await env.sites.head(siteKey);

      const deepLink = `t.me/wizytowka_klient_bot?start=${ownerToken}`;
      let line = `\n${i + 1}. ${m.title} — ${m.category} — ${m.locality_name}`;
      if (siteObj) {
        line += `\n   🌐 wizytowka.link/${m.locality_slug}/${m.slug}`;
      }
      line += `\n   🤖 ${deepLink}`;
      if (!siteObj) {
        line += `\n   (strona nie wygenerowana)`;
      }

      lines.push(line);
    }

    matchBlock = lines.join('\n');
  } else {
    matchBlock = 'Brak firm z tym numerem w bazie';
  }

  // Query sellers with Telegram
  const sellers = await env.leadgen
    .prepare('SELECT id, name, notify_chat_id, token FROM sellers WHERE notify_chat_id IS NOT NULL')
    .all<SellerRow>();

  const msg = `📞 <b>Nowy kontakt z formularza</b>\n\nTelefon: ${phone}\n\n${matchBlock}`;

  for (const seller of sellers.results) {
    await sendMessage(env.TG_NOTIFY_BOT_TOKEN, seller.notify_chat_id!, msg);
  }

  return json({ ok: true });
};
