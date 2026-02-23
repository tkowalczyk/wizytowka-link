# DD-006c: Panel Sprzedawcy -- SellerPanel Component + Client JS

## Przeglad

Astro component rendering lead cards with filters, pagination, click-to-call. Client JS handles locality/sort navigation, optimistic status updates (via [006b API](./006b-seller-api.md)), comment saves. Data provided by [006a page](./006a-seller-panel-page.md).

## Cele

- SellerPanel.astro component (header, filters, lead cards, pagination)
- Client JS: locality/sort navigation, status change with optimistic update, comment save
- STATUS_CONFIG as single source of truth (server + client)
- tel: links, conditional site links

## Nie-cele

- Data fetching (see [006a](./006a-seller-panel-page.md))
- API implementation (see [006b](./006b-seller-api.md))
- Offline support

---

## Types

```ts
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

interface Locality {
  slug: string;
  name: string;
}

interface Props {
  seller: Seller;
  leads: Lead[];
  localities: Locality[];
  currentStatus: string;
  currentLocality: string;
  currentSort: string;
  token: string;
  page: number;
  totalPages: number;
  totalLeads: number;
}
```

## STATUS_CONFIG

Single source of truth. Rendered as `data-config` attribute on hidden div, read by client JS.

```ts
const STATUS_CONFIG = {
  pending:     { color: 'bg-gray-200 text-gray-700',  label: 'Oczekujacy' },
  called:      { color: 'bg-blue-100 text-blue-700',   label: 'Zadzwoniono' },
  interested:  { color: 'bg-green-100 text-green-700', label: 'Zainteresowany' },
  rejected:    { color: 'bg-red-100 text-red-700',     label: 'Odrzucony' },
} as const;
```

---

## Implementacja

### `src/components/SellerPanel.astro`

```astro
---
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

interface Locality {
  slug: string;
  name: string;
}

interface Props {
  seller: Seller;
  leads: Lead[];
  localities: Locality[];
  currentStatus: string;
  currentLocality: string;
  currentSort: string;
  token: string;
  page: number;
  totalPages: number;
  totalLeads: number;
}

const { seller, leads, localities, currentStatus, currentLocality, currentSort, token, page, totalPages, totalLeads } = Astro.props;

const STATUS_CONFIG = {
  pending:     { color: 'bg-gray-200 text-gray-700',  label: 'Oczekujacy' },
  called:      { color: 'bg-blue-100 text-blue-700',   label: 'Zadzwoniono' },
  interested:  { color: 'bg-green-100 text-green-700', label: 'Zainteresowany' },
  rejected:    { color: 'bg-red-100 text-red-700',     label: 'Odrzucony' },
} as const;

type StatusKey = keyof typeof STATUS_CONFIG;
const statuses: ('all' | StatusKey)[] = ['all', 'pending', 'called', 'interested', 'rejected'];
---

<div class="max-w-7xl mx-auto px-4 py-6">
  <!-- Header -->
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold text-gray-900">Panel: {seller.name}</h1>
    <span class="text-sm text-gray-500">{totalLeads} leadow</span>
  </div>

  <!-- Filtry statusu -->
  <div class="flex flex-wrap gap-2 mb-4">
    {statuses.map((s) => (
      <a
        href={`/s/${token}?status=${s}&locality=${currentLocality}&sort=${currentSort}`}
        class={`px-3 py-1 rounded-full text-sm font-medium transition
          ${currentStatus === s
            ? 'bg-indigo-600 text-white'
            : 'bg-white text-gray-600 border hover:bg-gray-50'}`}
      >
        {s === 'all' ? 'Wszystkie' : STATUS_CONFIG[s].label}
      </a>
    ))}
  </div>

  <!-- Filtr miejscowosci + sortowanie -->
  <div class="flex gap-4 mb-6">
    <select
      id="locality-filter"
      class="border rounded-lg px-3 py-2 text-sm bg-white"
      data-token={token}
      data-status={currentStatus}
      data-sort={currentSort}
    >
      <option value="">Wszystkie miejscowosci</option>
      {localities.map((loc) => (
        <option value={loc.slug} selected={currentLocality === loc.slug}>
          {loc.name}
        </option>
      ))}
    </select>

    <select
      id="sort-select"
      class="border rounded-lg px-3 py-2 text-sm bg-white"
      data-token={token}
      data-status={currentStatus}
      data-locality={currentLocality}
    >
      <option value="date" selected={currentSort === 'date'}>Wg daty</option>
      <option value="status" selected={currentSort === 'status'}>Wg statusu</option>
    </select>
  </div>

  <!-- Status config for client JS (single source of truth) -->
  <div id="status-config" data-config={JSON.stringify(STATUS_CONFIG)} class="hidden" />

  <!-- Lista leadow -->
  {leads.length === 0 ? (
    <p class="text-gray-500 text-center py-12">Brak leadow z tymi filtrami.</p>
  ) : (
    <div class="space-y-3">
      {leads.map((lead) => (
        <div
          class="bg-white rounded-lg shadow-sm border p-4"
          data-lead-id={lead.id}
          id={`lead-${lead.id}`}
        >
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <!-- Info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h3 class="font-semibold text-gray-900 truncate">{lead.title}</h3>
                {lead.rating && (
                  <span class="text-xs text-yellow-600">{lead.rating}</span>
                )}
              </div>
              <p class="text-sm text-gray-500">{lead.address}</p>
              <div class="flex gap-3 mt-1 text-xs text-gray-400">
                <span>{lead.category}</span>
                <span>{lead.locality_name}</span>
                <span>{lead.created_at?.slice(0, 10)}</span>
              </div>
            </div>

            <!-- Akcje -->
            <div class="flex items-center gap-2 flex-shrink-0">
              <a
                href={`tel:${lead.phone}`}
                class="inline-flex items-center px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
              >
                {lead.phone}
              </a>
              {lead.site_generated ? (
                <a
                  href={`/${lead.loc_slug}/${lead.biz_slug}`}
                  target="_blank"
                  class="px-3 py-1.5 bg-indigo-50 text-indigo-600 text-sm rounded-lg hover:bg-indigo-100"
                >
                  Strona
                </a>
              ) : (
                <span class="px-3 py-1.5 bg-gray-100 text-gray-400 text-sm rounded-lg">
                  Brak strony
                </span>
              )}
            </div>
          </div>

          <!-- Status + komentarz -->
          <div class="flex flex-col sm:flex-row gap-3 mt-3 pt-3 border-t">
            <select
              class="status-select border rounded px-2 py-1 text-sm"
              data-lead-id={lead.id}
              data-token={token}
            >
              {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
                <option value={val} selected={lead.status === val}>
                  {cfg.label}
                </option>
              ))}
            </select>

            <div class="flex-1 flex gap-2">
              <input
                type="text"
                class="comment-input flex-1 border rounded px-2 py-1 text-sm"
                placeholder="Komentarz..."
                value={lead.comment ?? ''}
                data-lead-id={lead.id}
                data-token={token}
              />
              <button
                class="save-comment px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded hover:bg-gray-200"
                data-lead-id={lead.id}
              >
                Zapisz
              </button>
            </div>

            <span
              class={`status-badge inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_CONFIG[lead.status as StatusKey]?.color ?? ''}`}
              data-lead-id={lead.id}
            >
              {STATUS_CONFIG[lead.status as StatusKey]?.label ?? lead.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  )}

  <!-- Paginacja -->
  {totalPages > 1 && (
    <div class="flex justify-center gap-2 mt-6">
      {page > 1 && (
        <a
          href={`/s/${token}?status=${currentStatus}&locality=${currentLocality}&sort=${currentSort}&page=${page - 1}`}
          class="px-3 py-1 rounded border text-sm hover:bg-gray-50"
        >Poprzednia</a>
      )}
      <span class="px-3 py-1 text-sm text-gray-500">{page} / {totalPages}</span>
      {page < totalPages && (
        <a
          href={`/s/${token}?status=${currentStatus}&locality=${currentLocality}&sort=${currentSort}&page=${page + 1}`}
          class="px-3 py-1 rounded border text-sm hover:bg-gray-50"
        >Nastepna</a>
      )}
    </div>
  )}
</div>
```

---

## Client JS

`<script>` at bottom of SellerPanel.astro:

```html
<script>
  // nawigacja filtra miejscowosci
  document.getElementById('locality-filter')?.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    const token = el.dataset.token;
    const status = el.dataset.status;
    const sort = el.dataset.sort;
    window.location.href = `/s/${token}?status=${status}&locality=${el.value}&sort=${sort}`;
  });

  // nawigacja sortowania
  document.getElementById('sort-select')?.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    const token = el.dataset.token;
    const status = el.dataset.status;
    const locality = el.dataset.locality;
    window.location.href = `/s/${token}?status=${status}&locality=${locality}&sort=${el.value}`;
  });

  // status change -- optymistyczny update
  document.querySelectorAll('.status-select').forEach((select) => {
    select.addEventListener('change', async (e) => {
      const el = e.target as HTMLSelectElement;
      const leadId = el.dataset.leadId;
      const token = el.dataset.token;

      const commentInput = document.querySelector(
        `.comment-input[data-lead-id="${leadId}"]`
      ) as HTMLInputElement;

      const res = await fetch(`/api/leads/${leadId}?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: el.value,
          comment: commentInput?.value || undefined,
        }),
      });

      if (res.ok) {
        // update badge from STATUS_CONFIG data attribute
        const badge = document.querySelector(
          `.status-badge[data-lead-id="${leadId}"]`
        ) as HTMLElement;
        if (badge) {
          const cfg = JSON.parse(document.getElementById('status-config')?.dataset.config ?? '{}');
          const c = cfg[el.value] ?? { color: '', label: el.value };
          badge.className = `status-badge inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.color}`;
          badge.textContent = c.label;
        }
      } else {
        alert('Blad zapisu statusu');
        window.location.reload();
      }
    });
  });

  // save comment — only sends comment, does NOT re-send status (avoids spurious call_log)
  document.querySelectorAll('.save-comment').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const el = btn as HTMLButtonElement;
      const leadId = el.dataset.leadId;

      const commentInput = document.querySelector(
        `.comment-input[data-lead-id="${leadId}"]`
      ) as HTMLInputElement;
      const statusSelect = document.querySelector(
        `.status-select[data-lead-id="${leadId}"]`
      ) as HTMLSelectElement;
      const token = statusSelect?.dataset.token;

      const res = await fetch(`/api/leads/${leadId}?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment: commentInput?.value,
        }),
      });

      if (res.ok) {
        el.textContent = 'Zapisano!';
        setTimeout(() => (el.textContent = 'Zapisz'), 1500);
      } else {
        alert('Blad zapisu komentarza');
      }
    });
  });
</script>
```

Key behaviors:
- **Locality filter** -- `change` event navigates to new URL with locality param
- **Sort select** -- `change` event navigates to new URL with sort param
- **Status change** -- `change` on `.status-select` sends PUT with status + current comment, updates badge optimistically using STATUS_CONFIG from data attribute
- **Comment save** -- `click` on `.save-comment` sends PUT with comment only (no `status` field), avoids creating new call_log entry. Button text flashes "Zapisano!" for 1.5s

---

## Weryfikacja

1. **tel: link present** -- each lead card has `<a href="tel:...">` with phone number

2. **Site link conditional** -- "Strona" link only when `site_generated = 1`, otherwise "Brak strony" span

3. **Status badge updates on change** -- select new status, badge color/text updates without page reload

4. **Comment saves without new call_log** -- click "Zapisz", verify call_log count unchanged:
   ```bash
   pnpm wrangler d1 execute leadgen --command="SELECT COUNT(*) FROM call_log"
   pnpm wrangler d1 execute leadgen --command="SELECT COUNT(*) FROM call_log" --remote
   # save comment
   # re-check count -- should be same
   ```

5. **Filters navigate correctly** -- changing locality dropdown or sort select triggers full page navigation with correct URL params

6. **Pagination links** -- preserve all current filter params (status, locality, sort)

7. **Empty state** -- "Brak leadow z tymi filtrami." when no leads match

---

## Referencje

- [DD-006: Panel Sprzedawcy](./006-seller-panel.md) -- original full doc
- [DD-006a: Panel Page](./006a-seller-panel-page.md) -- data source
- [DD-006b: API Endpoint](./006b-seller-api.md) -- PUT endpoint called by client JS
- [DD-001: Scaffold](./001-scaffold-infrastructure.md)

## Decyzje

- **STATUS_CONFIG single source of truth** -- defined in Astro frontmatter, serialized to `data-config` attribute, read by client JS. No duplication.
- **`site_generated` check** -- link shown only when `site_generated = 1`. Otherwise disabled span.
- **Comment-only save** -- sends `{ comment }` without `status` field. API handles as UPDATE (not INSERT).
- **Mobile-first** -- responsive layout. Phone link prominent for click-to-call from mobile.
- **Optimistic update** -- badge updates immediately. On failure: alert + reload.
