# DD-011c: Contact Form Business Match Context

## Overview

Enhance `/api/contact` POST to include matching businesses in admin Telegram notification.

**Independent** — no dependency on DD-011a/011b.

## Goals

- Query businesses matching submitted phone
- Admin notification includes match count + business details
- Zero matches: note "Brak firm z tym numerem w bazie"

---

## Implementation

After `normalizePhone` in `/api/contact`:

```ts
const matches = await env.leadgen.prepare(`
  SELECT b.title, b.category, l.name as locality_name
  FROM businesses b
  JOIN localities l ON b.locality_id = l.id
  WHERE b.phone = ?
`).bind(phone).all<{ title: string; category: string; locality_name: string }>();

const matchBlock = matches.results.length > 0
  ? `Pasujace firmy w bazie: ${matches.results.length}\n\n` +
    matches.results.map((m, i) =>
      `${i + 1}. ${m.title} — ${m.category} — ${m.locality_name}`
    ).join('\n')
  : 'Brak firm z tym numerem w bazie';

const msg = `📞 <b>Nowy kontakt z formularza</b>\n\nTelefon: ${phone}\n${matchBlock}`;
```

Example output (matches found):
```
📞 Nowy kontakt z formularza

Telefon: +48 600 123 456
Pasujace firmy w bazie: 2

1. Zaklad Stolarski Kowalski — stolarz — Stanislawow
2. Auto Naprawa Kowalski — mechanik — Stanislawow
```

---

## Files Changed

| File | Change |
|---|---|
| `src/pages/api/contact.ts` | Add business phone match query + format in admin notification |

## Verification

- [ ] Contact form sends admin notification with matching businesses
- [ ] Zero matches: "Brak firm z tym numerem w bazie" shown
- [ ] Multiple matches: all listed with title, category, locality
