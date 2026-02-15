# DD-007a: Telegram Client + Daily Report

## Przeglad

`src/lib/telegram.ts` — sendMessage wrapper + daily report formatter. Integrates at end of DD-004 scraper to notify sellers.

## Cele

- `sendMessage` wrapper (rate limit handling, 4096 truncation)
- `formatDailyReport` — HTML template
- `sendDailyReport` — sends formatted report per seller
- Integration with `scrapeBusinesses()` (DD-004)

## Nie-cele

- Webhook / `/start` handling (see DD-007b)
- Interactive bot commands
- Inline keyboard / callback queries
- Grupowe czaty
- Polling mode

---

## Typy

```ts
interface TelegramSendMessageParams {
  chat_id: string;
  text: string;
  parse_mode: 'Markdown' | 'MarkdownV2' | 'HTML';
}

interface TelegramSendMessageResponse {
  ok: boolean;
  result?: TelegramMessage;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  date: number;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  username?: string;
}

interface SellerRow {
  id: number;
  name: string;
  telegram_chat_id: string | null;
  token: string;
}

interface DailyReportStats {
  locality_name: string;
  total_businesses: number;
  new_leads: number;
  top_leads: LeadSummary[];
}

interface LeadSummary {
  title: string;
  category: string | null;
  phone: string | null;
}
```

---

## Implementacja

### `src/lib/telegram.ts`

```ts
const TG_API = 'https://api.telegram.org/bot';
const MAX_MESSAGE_LENGTH = 4096;
const MAX_TOP_LEADS = 5;

export async function sendMessage(
  env: Env,
  chatId: string,
  text: string
): Promise<TelegramSendMessageResponse> {
  const truncated = text.length > MAX_MESSAGE_LENGTH
    ? text.slice(0, MAX_MESSAGE_LENGTH - 3) + '...'
    : text;

  const res = await fetch(`${TG_API}${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: truncated,
      parse_mode: 'HTML',
    } satisfies TelegramSendMessageParams),
  });

  const data = await res.json() as TelegramSendMessageResponse;

  if (!data.ok) {
    // rate limit — log retry_after, nie rzucaj
    if (data.error_code === 429) {
      const wait = data.parameters?.retry_after ?? 30;
      console.log(`telegram: rate limited, retry after ${wait}s`);
      return data;
    }
    console.log(`telegram: error ${data.error_code}: ${data.description}`);
  }

  return data;
}

// Use HTML parse_mode — simpler escaping, no Markdown v1 deprecation risk
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDailyReport(
  seller: SellerRow,
  stats: DailyReportStats,
  date: string
): string {
  const leadsBlock = stats.top_leads
    .slice(0, MAX_TOP_LEADS)
    .map((l, i) => {
      const parts = [escapeHtml(l.title), l.category ? escapeHtml(l.category) : null, l.phone].filter(Boolean);
      return `${i + 1}. ${parts.join(' — ')}`;
    })
    .join('\n');

  const remaining = stats.new_leads - Math.min(stats.top_leads.length, MAX_TOP_LEADS);
  const moreLine = remaining > 0 ? `\n...i ${remaining} wiecej\n` : '';

  return [
    `<b>Raport dzienny — ${date}</b>`,
    '',
    `Przeszukano: ${escapeHtml(stats.locality_name)}`,
    `Znaleziono firm: ${stats.total_businesses}`,
    `Nowych leadow (bez www): ${stats.new_leads}`,
    '',
    stats.new_leads > 0 ? '<b>Top leady:</b>' : '',
    leadsBlock,
    moreLine,
    `<a href="https://wizytowka.link/s/${seller.token}">Otworz panel →</a>`,
  ].filter(Boolean).join('\n');
}

export async function sendDailyReport(
  env: Env,
  seller: SellerRow,
  stats: DailyReportStats
): Promise<void> {
  if (!seller.telegram_chat_id) return;

  const date = new Date().toISOString().slice(0, 10);
  const text = formatDailyReport(seller, stats, date);

  await sendMessage(env, seller.telegram_chat_id, text);
}
```

---

## Szablon wiadomosci

```html
<b>Raport dzienny — 2026-02-15</b>

Przeszukano: Stanislawow Pierwszy
Znaleziono firm: 47
Nowych leadow (bez www): 12

<b>Top leady:</b>
1. Zaklad Stolarski Kowalski — stolarz — +48 600 123 456
2. Piekarnia u Zosi — piekarnia — +48 601 234 567
3. Auto Serwis Nowak — mechanik — +48 602 345 678
4. Salon Fryzjerski Ewa — fryzjer — +48 603 456 789
5. Gabinet Fizjoterapii — fizjoterapia — +48 604 567 890
...i 7 wiecej

<a href="https://wizytowka.link/s/test-token-abc">Otworz panel →</a>
```

---

## Rate limity Telegram

| Limit | Wartosc |
|---|---|
| Wiadomosci do jednego czatu | 1/s |
| Wiadomosci ogolnie | 30/s |
| Broadcast do roznych chatow | 30 wiadomosci/s |

Przy kilku sellerach rate limit nie bedzie problemem. >30 sellerow → dodac `sleep(50)` miedzy sendami.

---

## Integracja ze scraperem (DD-004)

Na koncu `scrapeBusinesses()` w `src/lib/scraper.ts`, po `markSearched()`:

```ts
import { sendDailyReport } from './telegram';
import type { SellerRow, LeadSummary, DailyReportStats } from './telegram';

export async function scrapeBusinesses(env: Env): Promise<void> {
  const locality = await getNextLocality(env.leadgen);
  if (!locality) return;

  // ... istniejaca logika scrapera (searchCategory, batchInsert) ...

  await markSearched(env.leadgen, locality.id);

  // --- raport Telegram ---
  const totalResult = await env.leadgen.prepare(
    'SELECT COUNT(*) as cnt FROM businesses WHERE locality_id = ?'
  ).bind(locality.id).first<{ cnt: number }>();

  const leadsResult = await env.leadgen.prepare(
    'SELECT COUNT(*) as cnt FROM businesses WHERE locality_id = ? AND website IS NULL AND phone IS NOT NULL'
  ).bind(locality.id).first<{ cnt: number }>();

  const topLeads = await env.leadgen.prepare(`
    SELECT title, category, phone FROM businesses
    WHERE locality_id = ? AND website IS NULL AND phone IS NOT NULL
    ORDER BY id DESC LIMIT 5
  `).bind(locality.id).all<LeadSummary>();

  const stats: DailyReportStats = {
    locality_name: locality.name,
    total_businesses: totalResult?.cnt ?? 0,
    new_leads: leadsResult?.cnt ?? 0,
    top_leads: topLeads.results,
  };

  const sellers = await env.leadgen.prepare(
    'SELECT id, name, telegram_chat_id, token FROM sellers WHERE telegram_chat_id IS NOT NULL'
  ).all<SellerRow>();

  for (const seller of sellers.results) {
    try {
      await sendDailyReport(env, seller, stats);
    } catch (err) {
      console.log(`telegram: failed for seller ${seller.id}: ${err}`);
    }
  }
}
```

Telegram nie moze crashowac scrapera — raporty sa best-effort (fire-and-forget per seller).

---

## Obsluga bledow

| Scenariusz | Akcja |
|---|---|
| Rate limit (429) | Log `retry_after`, skip — raport dotrze jutro |
| Wiadomosc > 4096 zn | Truncate do 4096 z `...` |
| Bot zablokowany przez usera (403) | Log, skip |
| Nieprawidlowy chat_id | Log, skip |
| Blad sieci do TG API | try/catch w scraper loop, log, nie crashuj scrapera |

---

## Weryfikacja

- [ ] `TG_BOT_TOKEN` ustawiony w `.production.vars`
- [ ] Test sendMessage: `curl "https://api.telegram.org/bot{TOKEN}/sendMessage?chat_id={ID}&text=test"` → wiadomosc przychodzi
- [ ] Uruchom scraper cron → wiadomosc Telegram z raportem
- [ ] Kliknij "Otworz panel" w wiadomosci → otwiera `/s/{token}`
- [ ] Wiadomosc z >5 leadami → pokazuje top 5 + "...i N wiecej"
- [ ] Seller bez `telegram_chat_id` → brak wiadomosci (bez bledu)
- [ ] Wiadomosc ≤4096 znakow (truncation dziala)
- [ ] Raport formatuje sie poprawnie w HTML

---

## Referencje

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage)
- [Telegram rate limits](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this)
- DD-001: Scaffold + infrastruktura
- DD-004: Scraper
- DD-006: Panel sprzedawcy
- DD-007: Original combined doc

## Decyzje

- **HTML parse_mode** — simpler escaping, no Markdown v1 deprecation risk
- **Pusty scrape** — wysylac raport z "0 firm". Seller wie ze system dziala.
- **Per-seller filtering** — nie. Jeden raport, te same leady dla wszystkich.
- **Retry** — fire-and-forget. Raport dotrze jutro jesli dzis fail.
