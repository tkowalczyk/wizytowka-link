# DD-006a: Panel Sprzedawcy -- Page + SQL Query Logic

## Przeglad

Server-side Astro page `/s/{token}` -- validates seller token, builds dynamic SQL query with filters/pagination, renders SellerPanel component. No auth system; token in URL path = access.

## Cele

- Token validation (SELECT sellers)
- URL param parsing (status, locality, sort, page)
- Dynamic query with filters + pagination
- COUNT query for total pages
- Localities list for filter dropdown
- HTML shell with noindex meta

## Nie-cele

- Client JS / UI interactions (see [006c](./006c-seller-panel-ui.md))
- API endpoint (see [006b](./006b-seller-api.md))
- Auth beyond token check

---

## Status Flow

```
pending --> called --> interested
                  \--> rejected
```

- `pending` -- domyslny, nieobdzwoniony
- `called` -- proba kontaktu
- `interested` -- firma chce strone
- `rejected` -- niezainteresowana

---

## Implementacja

### `src/pages/s/[token].astro`

```astro
---
import SellerPanel from '../../components/SellerPanel.astro';

interface Seller {
  id: number;
  name: string;
  token: string;
}

interface Lead {
  id: number;
  title: string;
  phone: string;
  address: string;
  category: string;
  rating: number | null;
  biz_slug: string;
  loc_slug: string;
  locality_name: string;
  site_generated: number;
  status: string;
  comment: string | null;
  created_at: string;
}

const { token } = Astro.params;
const db = Astro.locals.runtime.env.DB;

// walidacja tokenu
const seller = await db
  .prepare('SELECT * FROM sellers WHERE token = ?')
  .bind(token)
  .first<Seller>();

if (!seller) {
  return new Response(null, { status: 404 });
}

// parametry filtrow z URL
const url = new URL(Astro.request.url);
const statusFilter = url.searchParams.get('status');
const localityFilter = url.searchParams.get('locality');
const sortBy = url.searchParams.get('sort') || 'date';
const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
const PAGE_SIZE = 50;

// buduj query dynamicznie
let query = `
  SELECT
    b.id, b.title, b.phone, b.address, b.category, b.rating,
    b.slug as biz_slug, l.slug as loc_slug, l.name as locality_name,
    b.site_generated,
    COALESCE(cl.status, 'pending') as status,
    cl.comment,
    b.created_at
  FROM businesses b
  JOIN localities l ON b.locality_id = l.id
  LEFT JOIN (
    SELECT business_id, status, comment,
      ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC) as rn
    FROM call_log WHERE seller_id = ?1
  ) cl ON cl.business_id = b.id AND cl.rn = 1
  WHERE b.website IS NULL AND b.phone IS NOT NULL
`;

const params: (string | number)[] = [seller.id];

if (statusFilter && statusFilter !== 'all') {
  if (statusFilter === 'pending') {
    query += ` AND (cl.status IS NULL OR cl.status = 'pending')`;
  } else {
    query += ` AND cl.status = ?${params.length + 1}`;
    params.push(statusFilter);
  }
}

if (localityFilter) {
  query += ` AND l.slug = ?${params.length + 1}`;
  params.push(localityFilter);
}

// sortowanie + paginacja
if (sortBy === 'status') {
  query += ` ORDER BY cl.status ASC, b.created_at DESC`;
} else {
  query += ` ORDER BY b.created_at DESC`;
}

query += ` LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
params.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);

const leads = await db
  .prepare(query)
  .bind(...params)
  .all<Lead>();

// total count dla paginacji
let countQuery = `
  SELECT COUNT(*) as cnt
  FROM businesses b
  JOIN localities l ON b.locality_id = l.id
  LEFT JOIN (
    SELECT business_id, status,
      ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC) as rn
    FROM call_log WHERE seller_id = ?1
  ) cl ON cl.business_id = b.id AND cl.rn = 1
  WHERE b.website IS NULL AND b.phone IS NOT NULL
`;
// re-apply filters (same logic as above, without ORDER/LIMIT)
const countParams: (string | number)[] = [seller.id];
if (statusFilter && statusFilter !== 'all') {
  if (statusFilter === 'pending') {
    countQuery += ` AND (cl.status IS NULL OR cl.status = 'pending')`;
  } else {
    countQuery += ` AND cl.status = ?${countParams.length + 1}`;
    countParams.push(statusFilter);
  }
}
if (localityFilter) {
  countQuery += ` AND l.slug = ?${countParams.length + 1}`;
  countParams.push(localityFilter);
}
const totalResult = await db.prepare(countQuery).bind(...countParams).first<{ cnt: number }>();
const totalLeads = totalResult?.cnt ?? 0;
const totalPages = Math.ceil(totalLeads / PAGE_SIZE);

// lista unikalnych miejscowosci do filtra
const localities = await db
  .prepare(`
    SELECT DISTINCT l.slug, l.name
    FROM localities l
    JOIN businesses b ON b.locality_id = l.id
    WHERE b.website IS NULL AND b.phone IS NOT NULL
    ORDER BY l.name
  `)
  .all<{ slug: string; name: string }>();
---

<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Panel - {seller.name}</title>
  <!-- Tailwind z @astrojs/tailwind (DD-001), brak CDN -->
</head>
<body class="bg-gray-50 min-h-screen">
  <SellerPanel
    seller={seller}
    leads={leads.results ?? []}
    localities={localities.results ?? []}
    currentStatus={statusFilter || 'all'}
    currentLocality={localityFilter || ''}
    currentSort={sortBy}
    token={token!}
    page={page}
    totalPages={totalPages}
    totalLeads={totalLeads}
  />
</body>
</html>
```

---

## SQL

### Leady sprzedawcy (glowne query)

```sql
SELECT
  b.id, b.title, b.phone, b.address, b.category, b.rating,
  b.slug as biz_slug, l.slug as loc_slug, l.name as locality_name,
  COALESCE(cl.status, 'pending') as status,
  cl.comment,
  b.created_at
FROM businesses b
JOIN localities l ON b.locality_id = l.id
LEFT JOIN (
  SELECT business_id, status, comment,
    ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC) as rn
  FROM call_log WHERE seller_id = ?1
) cl ON cl.business_id = b.id AND cl.rn = 1
WHERE b.website IS NULL AND b.phone IS NOT NULL
ORDER BY b.created_at DESC;
```

Subquery z `ROW_NUMBER()` -- pobiera ostatni log per firma. D1/SQLite 3.45+ wspiera window functions.

### Count query

```sql
SELECT COUNT(*) as cnt
FROM businesses b
JOIN localities l ON b.locality_id = l.id
LEFT JOIN (
  SELECT business_id, status,
    ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC) as rn
  FROM call_log WHERE seller_id = ?1
) cl ON cl.business_id = b.id AND cl.rn = 1
WHERE b.website IS NULL AND b.phone IS NOT NULL;
```

Same base + same filters, no ORDER/LIMIT. Used for pagination total.

### Miejscowosci do filtra

```sql
SELECT DISTINCT l.slug, l.name
FROM localities l
JOIN businesses b ON b.locality_id = l.id
WHERE b.website IS NULL AND b.phone IS NOT NULL
ORDER BY l.name;
```

---

## Token Validation

- Token z URL path: `/s/{token}` -- walidacja server-side w Astro page
- Brak tokenu / zly token -> 404
- Token jest unikalny (`UNIQUE INDEX` na `sellers.token`)
- `noindex, nofollow` -- strona panelu nieindeksowana

---

## Weryfikacja

1. **Seed test seller**
   ```bash
   wrangler d1 execute leadgen --command="INSERT INTO sellers (name, telegram_chat_id, token) VALUES ('Jan', '123', 'test-token-abc')"
   ```

2. **Panel sie otwiera**
   ```bash
   curl http://localhost:4321/s/test-token-abc
   # oczekiwany: HTML z lista leadow
   ```

3. **Zly token -> 404**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/s/invalid-token
   # oczekiwany: 404
   ```

4. **Filtry dzialaja**
   ```bash
   curl "http://localhost:4321/s/test-token-abc?status=called"
   curl "http://localhost:4321/s/test-token-abc?locality=stanislawow-pierwszy"
   ```

5. **Paginacja** -- page=2 returns next batch, page param preserved in filter links

6. **noindex meta present** in `<head>`

---

## Referencje

- [DD-006: Panel Sprzedawcy](./006-seller-panel.md) -- original full doc
- [DD-006b: API Endpoint](./006b-seller-api.md) -- PUT /api/leads/[id]
- [DD-006c: UI Component](./006c-seller-panel-ui.md) -- SellerPanel + client JS
- [DD-001: Scaffold](./001-scaffold-infrastructure.md)
- [D1 prepared statements](https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/)

## Decyzje

- **Paginacja** -- offset pagination, 50 leadow/strona. `LIMIT 50 OFFSET (page-1)*50`.
- **Wielu sellerow** -- wszyscy widza te same leady. `call_log` per-seller, brak kolizji.
- **Tailwind** -- z `@astrojs/tailwind` (DD-001). Brak CDN.
