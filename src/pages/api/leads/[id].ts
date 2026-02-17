import type { APIRoute } from 'astro';
import type { SellerRow, CallLogRow } from '../../../types/business';

interface UpdateLeadBody {
  status?: CallLogRow['status'];
  comment?: string;
}

const VALID_STATUSES: readonly CallLogRow['status'][] = [
  'pending',
  'called',
  'interested',
  'rejected',
] as const;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.leadgen;
  const id = parseInt(params.id ?? '', 10);
  if (isNaN(id)) return json({ error: 'nieprawidlowe ID' }, 400);

  const url = new URL(request.url);
  const token =
    request.headers.get('X-Seller-Token') || url.searchParams.get('token');

  if (!token) return json({ error: 'brak tokenu' }, 401);

  const seller = await db
    .prepare('SELECT * FROM sellers WHERE token = ?')
    .bind(token)
    .first<SellerRow>();

  if (!seller) return json({ error: 'nieprawidlowy token' }, 401);

  let body: UpdateLeadBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'nieprawidlowy JSON' }, 400);
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return json({ error: 'nieprawidlowy status', valid: VALID_STATUSES }, 400);
  }

  if (!body.status && body.comment !== undefined) {
    await db
      .prepare(
        `UPDATE call_log SET comment = ?
         WHERE id = (SELECT id FROM call_log WHERE business_id = ? AND seller_id = ? ORDER BY created_at DESC LIMIT 1)`
      )
      .bind(body.comment, id, seller.id)
      .run();
    return json({ ok: true });
  }

  if (!body.status) return json({ error: 'status lub comment wymagany' }, 400);

  const biz = await db
    .prepare('SELECT id FROM businesses WHERE id = ?')
    .bind(id)
    .first();

  if (!biz) return json({ error: 'firma nie istnieje' }, 404);

  await db
    .prepare(
      'INSERT INTO call_log (business_id, seller_id, status, comment) VALUES (?, ?, ?, ?)'
    )
    .bind(id, seller.id, body.status, body.comment ?? null)
    .run();

  return json({ ok: true, status: body.status });
};
