# DD-007b: Telegram Webhook + /start Deep Link

## Przeglad

Webhook endpoint handles `/start {token}` deep link to bind seller's `telegram_chat_id`. Uses `sendMessage` from DD-007a (`src/lib/telegram.ts`).

## Cele

- Webhook route `src/pages/api/telegram/[secret].ts`
- `/start {token}` → lookup seller by token → save `chat_id`
- Edge cases: no token, bad token, already registered
- Always return 200 (prevent Telegram retry loops)

## Nie-cele

- sendMessage / report logic (DD-007a)
- Interactive commands beyond `/start`
- Inline keyboard / callback queries
- Polling mode

---

## Bot Setup

```bash
# BotFather
/newbot → wizytowka_link_bot → zapisz token

# .production.vars
TG_BOT_TOKEN=...
TG_WEBHOOK_SECRET=...   # python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Webhook (po deployu) — secret w URL path
curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://wizytowka.link/api/telegram/webhook/{TG_WEBHOOK_SECRET}"
```

Token w `env.TG_BOT_TOKEN`, secret w `env.TG_WEBHOOK_SECRET` (declared DD-001, values in `.production.vars`).

---

## Typy

```ts
// TelegramUpdate — other types defined in DD-007a (src/lib/telegram.ts)
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
```

`TelegramMessage`, `TelegramChat` — imported/referenced from DD-007a types.

---

## Implementacja

### `src/pages/api/telegram/[secret].ts`

Astro dynamic route `[secret].ts` maps to `/api/telegram/{SECRET}`. Secret via `params.secret`.

```ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime.env;

  if (params.secret !== env.TG_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const update = await request.json() as TelegramUpdate;

  if (!update.message?.text) {
    return new Response('ok');
  }

  const text = update.message.text.trim();
  const chatId = String(update.message.chat.id);

  // /start {seller_token} — deep link rejestracja
  if (text.startsWith('/start')) {
    const token = text.split(' ')[1];

    if (!token) {
      await sendReply(env, chatId, 'Uzyj linku rejestracyjnego od administratora.');
      return new Response('ok');
    }

    const seller = await env.leadgen.prepare(
      'SELECT id, telegram_chat_id FROM sellers WHERE token = ?'
    ).bind(token).first<{ id: number; telegram_chat_id: string | null }>();

    if (!seller) {
      await sendReply(env, chatId, 'Nieprawidlowy token.');
      return new Response('ok');
    }

    if (seller.telegram_chat_id === chatId) {
      await sendReply(env, chatId, 'Juz jestes zarejestrowany.');
      return new Response('ok');
    }

    await env.leadgen.prepare(
      'UPDATE sellers SET telegram_chat_id = ? WHERE token = ?'
    ).bind(chatId, token).run();

    await sendReply(env, chatId, 'Zarejestrowano! Bedziesz otrzymywac codzienne raporty.');
    return new Response('ok');
  }

  return new Response('ok');
};

async function sendReply(env: Env, chatId: string, text: string): Promise<void> {
  const { sendMessage } = await import('../../../lib/telegram');
  await sendMessage(env, chatId, text);
}
```

Webhook zawsze zwraca 200 — Telegram retryuje przy innym kodzie, co tworzy petle.

---

## Deep linking flow

1. Admin tworzy sellera w D1 z tokenem `abc123`
2. Admin generuje link: `https://t.me/wizytowka_link_bot?start=abc123`
3. Sprzedawca klika link → otwiera bota → automatycznie wysyla `/start abc123`
4. Webhook parsuje token → `UPDATE sellers SET telegram_chat_id`
5. Odpowiedz: "Zarejestrowano!"

Format deep linku: `https://t.me/{bot_username}?start={payload}`

---

## Obsluga bledow

| Scenariusz | Akcja |
|---|---|
| Secret mismatch | 403 forbidden |
| Brak tekstu w update | Return 200, ignore |
| `/start` bez tokena | Reply: "Uzyj linku rejestracyjnego od administratora" |
| `/start` nieprawidlowy token | Reply: "Nieprawidlowy token" |
| `/start` juz zarejestrowany (same chat_id) | Reply: "Juz jestes zarejestrowany" |
| Nieznana komenda | Return 200, ignore |
| sendReply fails | Uncaught — Telegram will retry (acceptable, idempotent) |

---

## Weryfikacja

- [ ] Webhook set: `curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://wizytowka.link/api/telegram/webhook/{SECRET}"` → `{"ok":true}`
- [ ] `/start test-token-abc` do bota → `sellers.telegram_chat_id` zaktualizowane
- [ ] `/start` bez tokena → odpowiedz "Uzyj linku rejestracyjnego"
- [ ] `/start bad-token` → odpowiedz "Nieprawidlowy token"
- [ ] `/start` z tokenem juz zarejestrowanym → "Juz jestes zarejestrowany"
- [ ] Webhook zawsze zwraca 200 (check non-/start messages too)
- [ ] Wrong secret in URL → 403

---

## Referencje

- [Telegram webhooks](https://core.telegram.org/bots/api#setwebhook)
- [Telegram deep linking](https://core.telegram.org/bots/features#deep-linking)
- DD-001: Scaffold + infrastruktura
- DD-007a: Telegram Client + Daily Report (`sendMessage`)
- DD-007: Original combined doc

## Decyzje

- **Webhook secret** — secret w URL path: `/api/telegram/webhook/{TG_WEBHOOK_SECRET}`. Prosty, nie wymaga kryptografii.
- **Always 200** — Telegram retryuje przy innym kodzie. Wszystkie odpowiedzi 200.
- **Dynamic import** — `sendReply` uses `await import('../../../lib/telegram')` to keep webhook handler decoupled.
- **`/stop`** — nie. Out of scope. Seller kontaktuje admina.
