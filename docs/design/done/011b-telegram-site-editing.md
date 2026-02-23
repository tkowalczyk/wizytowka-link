# DD-011b: Telegram Site Editing

## Overview

Owner sends natural language edit instruction -> GLM-5 patches SiteData JSON -> draft preview -> approve/reject inline keyboard.

**Depends on**: DD-011a (business_owners table + auth)

## Goals

- Owner sends message, GLM-5 patches current SiteData JSON (not regenerate)
- Draft stored in R2, preview link sent to owner
- Inline keyboard approve/reject before publish
- Phone + theme enforced immutable post-GLM

## Non-Goals

- Image/logo uploads
- Conversation history / multi-turn editing (single instruction per edit)
- Rate limiting (future enhancement)

---

## Editing Flow

### 1. Owner sends message

Any non-command message from a registered owner chat_id triggers editing flow.

```ts
const owner = await env.leadgen.prepare(
  'SELECT business_id FROM business_owners WHERE chat_id = ?'
).bind(chatId).first<{ business_id: number }>();

if (!owner) {
  return new Response('ok'); // ignore unregistered users
}

const biz = await env.leadgen.prepare(
  'SELECT slug, locality_id FROM businesses WHERE id = ?'
).bind(owner.business_id).first<{ slug: string; locality_id: number }>();

const loc = await env.leadgen.prepare(
  'SELECT slug FROM localities WHERE id = ?'
).bind(biz.locality_id).first<{ slug: string }>();

const key = `sites/${loc.slug}/${biz.slug}.json`;
const obj = await env.sites.get(key);
if (!obj) {
  await sendReply(env, chatId, 'Wizytowka jeszcze nie zostala wygenerowana.');
  return new Response('ok');
}

const currentSite = await obj.json() as SiteData;
```

### 2. GLM-5 patch

```ts
const EDIT_SYSTEM_PROMPT = `Jestes asystentem edycji wizytowek firmowych.
Otrzymujesz obecny JSON wizytowki i instrukcje od wlasciciela firmy.
Zwroc CALY zaktualizowany JSON z naniesionymi zmianami.
Odpowiedz TYLKO JSON, bez markdown, bez komentarzy.

Dozwolone edycje:
- Dodawanie/edycja/usuwanie uslug (services)
- Zmiana godzin pracy (w about.text lub contact)
- Zmiana adresu (contact.address)
- Edycja opisu firmy (about.text, hero)

NIE WOLNO zmieniac:
- Numeru telefonu (contact.phone)
- Motywu (theme)

Jesli instrukcja jest niejasna, zrob najlepsza interpretacje.
Jesli instrukcja jest poza dozwolonym zakresem, zwroc oryginalny JSON bez zmian.`;

const messages = [
  { role: 'system', content: EDIT_SYSTEM_PROMPT },
  { role: 'user', content: `Obecna wizytowka:\n${JSON.stringify(currentSite, null, 2)}\n\nInstrukcja: ${text}` },
];
```

Reuse `callGLM5` from `src/lib/generator.ts` (extract to shared util). Reuse `validateSiteData` for output validation.

### 3. Enforce immutability

```ts
const patched = validateSiteData(raw);
patched.phone = currentSite.contact.phone;
patched.theme = currentSite.theme;
```

### 4. Store draft in R2

```ts
const draftKey = `sites/draft/${loc.slug}/${biz.slug}.json`;
await env.sites.put(draftKey, JSON.stringify(patched), {
  httpMetadata: { contentType: 'application/json' },
});
```

One draft per business (overwrites previous).

### 5. Summary + preview + approve/reject

```ts
function summarizeChanges(old: SiteData, updated: SiteData): string {
  const changes: string[] = [];

  if (old.hero.headline !== updated.hero.headline)
    changes.push(`Naglowek: "${updated.hero.headline}"`);
  if (old.about.text !== updated.about.text)
    changes.push('Opis firmy: zmieniony');
  if (old.contact.address !== updated.contact.address)
    changes.push(`Adres: "${updated.contact.address}"`);

  const oldNames = old.services.map(s => s.name);
  const newNames = updated.services.map(s => s.name);
  const added = newNames.filter(n => !oldNames.includes(n));
  const removed = oldNames.filter(n => !newNames.includes(n));
  if (added.length) changes.push(`Nowe uslugi: ${added.join(', ')}`);
  if (removed.length) changes.push(`Usuniete uslugi: ${removed.join(', ')}`);

  return changes.length ? changes.join('\n') : 'Brak widocznych zmian';
}
```

Send with inline keyboard:

```ts
const previewUrl = `https://wizytowka.link/${loc.slug}/${biz.slug}?draft=1`;
const summary = summarizeChanges(currentSite, patched);

await fetch(`${TG_API}${env.TG_BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: chatId,
    text: `<b>Proponowane zmiany:</b>\n\n${escapeHtml(summary)}\n\n` +
          `<a href="${previewUrl}">Podglad wizytowki</a>`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: 'Zatwierdz', callback_data: `approve:${owner.business_id}` },
        { text: 'Odrzuc', callback_data: `reject:${owner.business_id}` },
      ]],
    },
  }),
});
```

### 6. Handle callback query (approve/reject)

```ts
if (update.callback_query) {
  const cb = update.callback_query;
  const chatId = String(cb.from.id);
  const data = cb.data ?? '';

  const owner = await env.leadgen.prepare(
    'SELECT business_id FROM business_owners WHERE chat_id = ?'
  ).bind(chatId).first<{ business_id: number }>();

  if (!owner) {
    await answerCallback(env, cb.id, 'Brak dostepu');
    return new Response('ok');
  }

  const [action, bizIdStr] = data.split(':');
  const bizId = parseInt(bizIdStr);

  if (bizId !== owner.business_id) {
    await answerCallback(env, cb.id, 'Brak dostepu');
    return new Response('ok');
  }

  const biz = await env.leadgen.prepare(
    'SELECT slug, locality_id FROM businesses WHERE id = ?'
  ).bind(bizId).first<{ slug: string; locality_id: number }>();
  const loc = await env.leadgen.prepare(
    'SELECT slug FROM localities WHERE id = ?'
  ).bind(biz.locality_id).first<{ slug: string }>();

  const draftKey = `sites/draft/${loc.slug}/${biz.slug}.json`;
  const prodKey = `sites/${loc.slug}/${biz.slug}.json`;

  if (action === 'approve') {
    const draft = await env.sites.get(draftKey);
    if (!draft) {
      await answerCallback(env, cb.id, 'Draft wygasl');
      return new Response('ok');
    }
    const body = await draft.text();
    await env.sites.put(prodKey, body, {
      httpMetadata: { contentType: 'application/json' },
    });
    await env.sites.delete(draftKey);
    await answerCallback(env, cb.id, 'Opublikowano!');
    await sendReply(env, chatId, 'Wizytowka zaktualizowana!');
  }

  if (action === 'reject') {
    await env.sites.delete(draftKey);
    await answerCallback(env, cb.id, 'Odrzucono');
    await sendReply(env, chatId, 'Zmiany odrzucone. Wyslij nowa instrukcje.');
  }

  return new Response('ok');
}
```

`answerCallbackQuery` wrapper:

```ts
async function answerCallback(env: Env, callbackId: string, text: string): Promise<void> {
  await fetch(`${TG_API}${env.TG_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}
```

---

## Draft Preview Route

Modify `src/pages/[loc]/[slug].astro` to support `?draft=1`:

```ts
const isDraft = Astro.url.searchParams.get('draft') === '1';
const r2Key = isDraft
  ? `sites/draft/${loc}/${slug}.json`
  : `sites/${loc}/${slug}.json`;
const obj = await r2.get(r2Key);
```

Draft preview: `Cache-Control: no-store`. Visual banner: "PODGLAD — ta wersja nie jest jeszcze opublikowana". No auth (slug obscurity sufficient).

---

## Editing Scope

| Field | Editable | Enforcement |
|---|---|---|
| `services` | Yes | GLM-5 |
| `about.text` | Yes | GLM-5 |
| `hero.headline` | Yes | GLM-5 |
| `hero.subheadline` | Yes | GLM-5 |
| `contact.address` | Yes | GLM-5 |
| `contact.cta_text` | Yes | GLM-5 |
| `seo.title` | Yes | GLM-5 (max 60 chars via validateSiteData) |
| `seo.description` | Yes | GLM-5 (max 155 chars via validateSiteData) |
| `contact.phone` | **No** | Overwritten post-GLM |
| `theme` | **No** | Overwritten post-GLM |

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/editor.ts` | **New** — `EDIT_SYSTEM_PROMPT`, `patchSiteData()`, `summarizeChanges()` |
| `src/lib/generator.ts` | Extract `callGLM5`, `validateSiteData` to shared (or re-export) |
| `src/lib/telegram.ts` | Add `answerCallback` helper |
| `src/pages/api/telegram/webhook/[secret].ts` | Owner message handling, callback queries |
| `src/pages/[loc]/[slug].astro` | `?draft=1` support + banner |

## Error Handling

| Scenario | Action |
|---|---|
| Owner's site not yet generated | Reply: "Wizytowka jeszcze nie zostala wygenerowana" |
| GLM-5 returns invalid JSON | Reply: "Nie udalo sie przetworzyc zmian. Sprobuj ponownie" |
| GLM-5 API error / timeout | Reply: "Blad serwera. Sprobuj za chwile" |
| Approve but draft missing | answerCallbackQuery: "Draft wygasl" |
| callback_data for wrong business_id | answerCallbackQuery: "Brak dostepu" |
| Owner sends message while draft pending | Overwrite draft (new edit replaces old) |

## Verification

- [ ] Owner sends edit message -> GLM-5 called, draft stored in R2 under `sites/draft/...`
- [ ] Bot replies with summary + inline keyboard
- [ ] Preview link `?draft=1` renders draft version with banner
- [ ] "Zatwierdz" -> draft copied to production, draft deleted
- [ ] "Odrzuc" -> draft deleted, prompt to try again
- [ ] Phone NOT changed even if GLM-5 tries
- [ ] Theme NOT changed even if GLM-5 tries

## References

- [Telegram InlineKeyboardMarkup](https://core.telegram.org/bots/api#inlinekeyboardmarkup)
- [Telegram answerCallbackQuery](https://core.telegram.org/bots/api#answercallbackquery)
- DD-011a: Owner Auth (prerequisite)
- DD-005a: GLM-5 Generator (`callGLM5`, `validateSiteData`)

## Decisions

- **One draft per business** — new edit overwrites previous. No cleanup needed.
- **No draft expiry** — persist until approved/rejected/overwritten.
- **No conversation history** — each message standalone. Small GLM-5 context.
- **Draft preview unauthenticated** — slug obscurity sufficient.
- **Phone enforcement post-GLM** — double defense (prompt + code override).
