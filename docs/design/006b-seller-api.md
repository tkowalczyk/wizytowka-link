# DD-006b: Panel Sprzedawcy -- API Endpoint PUT /api/leads/[id]

## Przeglad

Single PUT endpoint for status changes and comment updates. Token auth via header or query param. Append-only `call_log` for status changes; in-place update for comment-only edits.

## Cele

- Token validation (header `X-Seller-Token` or `?token=`)
- Body parsing + validation
- Status change -> INSERT into call_log
- Comment-only update -> UPDATE existing call_log
- Business existence check

## Nie-cele

- GET endpoint (panel page handles reads, see [006a](./006a-seller-panel-page.md))
- Batch operations
- DELETE / soft-delete

---

## Types

```ts
interface UpdateLeadBody {
  status: 'pending' | 'called' | 'interested' | 'rejected';
  comment?: string;
}

interface Seller {
  id: number;
  name: string;
  token: string;
}

const VALID_STATUSES = ['pending', 'called', 'interested', 'rejected'] as const;
```

---

## Implementacja

### `src/pages/api/leads/[id].ts`

```ts
import type { APIRoute } from 'astro';

interface UpdateLeadBody {
  status: 'pending' | 'called' | 'interested' | 'rejected';
  comment?: string;
}

interface Seller {
  id: number;
  name: string;
  token: string;
}

const VALID_STATUSES = ['pending', 'called', 'interested', 'rejected'] as const;

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB;
  const id = parseInt(params.id ?? '', 10);
  if (isNaN(id)) {
    return new Response(JSON.stringify({ error: 'nieprawidlowe ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // token z headera lub query param
  const url = new URL(request.url);
  const token =
    request.headers.get('X-Seller-Token') ||
    url.searchParams.get('token');

  if (!token) {
    return new Response(JSON.stringify({ error: 'brak tokenu' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const seller = await db
    .prepare('SELECT * FROM sellers WHERE token = ?')
    .bind(token)
    .first<Seller>();

  if (!seller) {
    return new Response(JSON.stringify({ error: 'nieprawidlowy token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // walidacja body
  let body: UpdateLeadBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'nieprawidlowy JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return new Response(
      JSON.stringify({ error: 'nieprawidlowy status', valid: VALID_STATUSES }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // comment-only update (no status change) — skip call_log insert if no status
  if (!body.status && body.comment !== undefined) {
    // update latest call_log comment without creating new entry
    await db.prepare(
      `UPDATE call_log SET comment = ?
       WHERE id = (SELECT id FROM call_log WHERE business_id = ? AND seller_id = ? ORDER BY created_at DESC LIMIT 1)`
    ).bind(body.comment, id, seller.id).run();
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.status) {
    return new Response(
      JSON.stringify({ error: 'status lub comment wymagany' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // sprawdz czy firma istnieje
  const biz = await db
    .prepare('SELECT id FROM businesses WHERE id = ?')
    .bind(id)
    .first();

  if (!biz) {
    return new Response(JSON.stringify({ error: 'firma nie istnieje' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // insert do call_log (append-only, nie update)
  await db
    .prepare(
      'INSERT INTO call_log (business_id, seller_id, status, comment) VALUES (?, ?, ?, ?)'
    )
    .bind(id, seller.id, body.status, body.comment ?? null)
    .run();

  return new Response(JSON.stringify({ ok: true, status: body.status }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

---

## Error Handling

| Scenariusz | Kod | Odpowiedz |
|---|---|---|
| Nieprawidlowe ID (NaN) | 400 | `{ error: 'nieprawidlowe ID' }` |
| Brak tokenu | 401 | `{ error: 'brak tokenu' }` |
| Zly token | 401 | `{ error: 'nieprawidlowy token' }` |
| Zly JSON body | 400 | `{ error: 'nieprawidlowy JSON' }` |
| Zly status | 400 | `{ error: 'nieprawidlowy status', valid: [...] }` |
| Brak status i comment | 400 | `{ error: 'status lub comment wymagany' }` |
| Firma nie istnieje | 404 | `{ error: 'firma nie istnieje' }` |
| Success (status change) | 200 | `{ ok: true, status: '...' }` |
| Success (comment-only) | 200 | `{ ok: true }` |

---

## Weryfikacja

1. **PUT status -> 200**
   ```bash
   curl -X PUT http://localhost:4321/api/leads/1?token=test-token-abc \
     -H 'Content-Type: application/json' \
     -d '{"status":"called","comment":"nie odbiera"}'
   # oczekiwany: 200 {"ok":true,"status":"called"}
   ```

2. **PUT z headerem**
   ```bash
   curl -X PUT http://localhost:4321/api/leads/1 \
     -H 'Content-Type: application/json' \
     -H 'X-Seller-Token: test-token-abc' \
     -d '{"status":"interested"}'
   # oczekiwany: 200
   ```

3. **PUT bez tokenu -> 401**
   ```bash
   curl -X PUT http://localhost:4321/api/leads/1 \
     -H 'Content-Type: application/json' \
     -d '{"status":"called"}'
   # oczekiwany: 401
   ```

4. **PUT zly status -> 400**
   ```bash
   curl -X PUT http://localhost:4321/api/leads/1?token=test-token-abc \
     -H 'Content-Type: application/json' \
     -d '{"status":"invalid"}'
   # oczekiwany: 400
   ```

5. **call_log created** -- after PUT with status, verify:
   ```bash
   wrangler d1 execute leadgen --command="SELECT * FROM call_log ORDER BY created_at DESC LIMIT 5"
   ```

6. **Comment-only update** -- no new call_log entry:
   ```bash
   curl -X PUT http://localhost:4321/api/leads/1?token=test-token-abc \
     -H 'Content-Type: application/json' \
     -d '{"comment":"zmieniony komentarz"}'
   # oczekiwany: 200 {"ok":true}
   # call_log count should NOT increase
   ```

---

## Referencje

- [DD-006: Panel Sprzedawcy](./006-seller-panel.md) -- original full doc
- [DD-006a: Panel Page](./006a-seller-panel-page.md) -- server-side page
- [DD-006c: UI Component](./006c-seller-panel-ui.md) -- client JS that calls this API
- [Astro server endpoints](https://docs.astro.build/en/guides/endpoints/#server-endpoints-api-routes)
- [D1 prepared statements](https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/)

## Decyzje

- **Token in header or query param** -- query param for simplicity in client JS fetch; header as alternative.
- **`call_log` append-only** -- kazda zmiana statusu = nowy rekord. Historia zachowana. Comment-only = UPDATE existing (no new row).
- **Rate limiting** -- nie. Wewnetrzne narzedzie, token-gated. CF Worker ma wbudowane DDoS protection.
- **Token security** -- token in URL exposed in browser history/logs. Accepted MVP risk.
