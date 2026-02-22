# DD-011a: Telegram Owner Auth

## Overview

DB schema + `/start biz_` deep link flow to bind business owners to their wizytowka via Telegram.

## Goals

- `business_owners` table (separate from `sellers`)
- `/start biz_{token}` deep link binds `chat_id -> business_id`
- Token format: `biz_{random_urlsafe_32}` (prefix distinguishes from seller tokens)

## Non-Goals

- Phone number changes via bot (admin-only)
- Multi-business per chat_id (1:1 assumed)
- Admin UI for token generation (direct D1 query for MVP)

---

## DB Changes

### Migration `0004-business-owners.sql`

```sql
CREATE TABLE IF NOT EXISTS business_owners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  chat_id     TEXT    NOT NULL UNIQUE,
  token       TEXT    NOT NULL UNIQUE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_business_owners_chat ON business_owners(chat_id);
CREATE INDEX idx_business_owners_token ON business_owners(token);
```

Separate from `sellers` table. Sellers are our sales team, owners are business customers.

---

## Types

```ts
// src/types/business.ts
export interface BusinessOwnerRow {
  id: number;
  business_id: number;
  chat_id: string;
  token: string;
  created_at: string;
}
```

```ts
// src/lib/telegram.ts — additions
export interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  message?: TelegramMessage;
  data?: string;
}

// update existing TelegramUpdate
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}
```

---

## Auth Flow

### 1. Admin creates token

Admin calls owner, confirms identity, then:

```sql
INSERT INTO business_owners (business_id, chat_id, token)
VALUES (?, '', ?)
```

`chat_id` empty until owner activates deep link. Token generated server-side. Admin sends SMS: `Edytuj wizytowke: https://t.me/wizytowka_link_bot?start=biz_abc123...`

### 2. Owner clicks deep link

Telegram sends `/start biz_abc123...` to webhook. Handler in `[secret].ts`:

```ts
if (text.startsWith('/start')) {
  const token = text.split(' ')[1];
  if (!token) { /* existing "use link" reply */ }

  // check seller token first (existing flow)
  if (!token.startsWith('biz_')) {
    // existing seller registration logic
  }

  // business owner flow
  const owner = await env.leadgen.prepare(
    'SELECT id, business_id, chat_id FROM business_owners WHERE token = ?'
  ).bind(token).first<{ id: number; business_id: number; chat_id: string }>();

  if (!owner) {
    await sendReply(env, chatId, 'Nieprawidlowy token.');
    return new Response('ok');
  }

  if (owner.chat_id === chatId) {
    await sendReply(env, chatId, 'Juz jestes polaczony. Wyslij wiadomosc aby edytowac wizytowke.');
    return new Response('ok');
  }

  await env.leadgen.prepare(
    'UPDATE business_owners SET chat_id = ? WHERE token = ?'
  ).bind(chatId, token).run();

  const biz = await env.leadgen.prepare(
    'SELECT title FROM businesses WHERE id = ?'
  ).bind(owner.business_id).first<{ title: string }>();

  await sendReply(env, chatId,
    `Polaczono z wizytowka: <b>${escapeHtml(biz?.title ?? '')}</b>\n\n` +
    'Wyslij wiadomosc aby edytowac, np.:\n' +
    '- "dodaj usluge: tapicerowanie"\n' +
    '- "zmien godziny otwarcia na 8-16"\n' +
    '- "zmien adres na ul. Nowa 5"'
  );
  return new Response('ok');
}
```

Deep link payload max 64 chars, `biz_` prefix + 32 char urlsafe = 36, fits.

---

## Files Changed

| File | Change |
|---|---|
| `migrations/0004-business-owners.sql` | New table |
| `src/types/business.ts` | Add `BusinessOwnerRow` |
| `src/lib/telegram.ts` | Add `TelegramCallbackQuery`, update `TelegramUpdate` |
| `src/pages/api/telegram/webhook/[secret].ts` | Handle `biz_` tokens in `/start` |

## Error Handling

| Scenario | Action |
|---|---|
| Invalid token | Reply: "Nieprawidlowy token" |
| Already bound | Reply: "Juz jestes polaczony" |
| Unregistered user sends message | Ignore (return 200) |

## Verification

- [ ] Migration runs: `pnpm db:migrate`
- [ ] `/start biz_token` -> binds chat_id in `business_owners`
- [ ] `/start biz_token` already bound -> "Juz jestes polaczony"
- [ ] Invalid token -> "Nieprawidlowy token"
- [ ] Always returns 200 to Telegram

## References

- [Telegram Deep Linking](https://core.telegram.org/bots/features#deep-linking)
- DD-007b: Telegram Webhook (`/start` handler)

## Decisions

- **Separate `business_owners` table** — not reusing `sellers`. Different role, different auth flow, different token prefix.
- **Token prefix `biz_`** — webhook distinguishes seller vs owner tokens without DB lookup.
