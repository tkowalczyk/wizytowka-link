import type { APIRoute } from 'astro';
import { sendMessage, type SellerRow } from '../../lib/telegram';

interface ContactBody {
  phone: string;
  token: string;
}

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
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

  // Query sellers with Telegram
  const sellers = await env.leadgen
    .prepare('SELECT id, name, telegram_chat_id, token FROM sellers WHERE telegram_chat_id IS NOT NULL')
    .all<SellerRow>();

  const msg = `📞 <b>Nowy kontakt z formularza</b>\n\nTelefon: ${phone}`;

  for (const seller of sellers.results) {
    await sendMessage(env, seller.telegram_chat_id!, msg);
  }

  return json({ ok: true });
};
