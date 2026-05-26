## Parent PRD

#43

## Type

AFK

## What to build

Deliver the thinnest end-to-end path from a generated public page visit to a stored chat session and Telegram start notification.

The public page replaces its direct contact area with a button labeled **"Zapytaj asystenta"**. Existing useful page context stays visible: address, opening hours, map, description, services, and similar non-contact content. Visible UI and structured metadata remove direct phone, email, and contact URL exposure while preserving address/opening-hours metadata.

Clicking the button opens a Polish chat shell with the approved first message and minimal privacy notice. Opening the chat creates a stored session, records enough analytics to compute chat start rate per page visit, and sends a Telegram "chat started" notification with business/page slug, timestamp, and referrer.

Plan reference: `plans/ai-asystent-chat-generowane-strony.md`, Phase 1.

## Assumptions

- Generated page content and business metadata already exist.
- A seller/admin notification target already exists or can be resolved through current seller data.
- Existing seller routes remain unchanged.
- No assistant LLM response is required in this issue beyond the static first message.

## Out of scope for this issue

- Do not build a multi-turn AI conversation.
- Do not persist visitor messages beyond the created session shell.
- Do not add end-chat behavior.
- Do not build a transcript view beyond a stored session identifier.
- Do not rename existing `seller` routes or internal conventions.

## Acceptance criteria

- [ ] A generated page with prior phone/contact data renders no visible phone number, email, `tel:` link, `mailto:` link, or contact URL, and renders a single CTA labeled "Zapytaj asystenta" - [test: generated page render test]
- [ ] Address, opening hours, map/location context, description, and services remain visible when source data exists - [test: generated page render test]
- [ ] LocalBusiness structured metadata omits phone/email/contact URL while preserving address and opening-hours data when available - [test: structured metadata unit test]
- [ ] Opening chat shows the first message: "Cześć! Jestem asystentem AI i nie reprezentuję bezpośrednio tego miejsca. Zapytaj mnie o to miejsce - jeśli sprawa wymaga kontaktu z człowiekiem, podpowiem Ci najlepszy następny krok." - [test: chat UI render test]
- [ ] Chat input area shows the privacy notice: "Rozmowa jest obsługiwana przez asystenta AI i może zostać zapisana, aby poprawiać jakość odpowiedzi." - [test: chat UI render test]
- [ ] Starting chat creates a stored session with page/business slug, start timestamp, referrer, user agent, and active status - [observable: `chat_sessions` row]
- [ ] Starting chat records a chat-start event that can be joined to page-visit events by page/business slug - [observable: analytics/event rows]
- [ ] Starting chat sends one Telegram start notification containing slug, timestamp, and referrer - [test: Telegram fetch mock assertion]
- [ ] Existing seller/admin route still authenticates and lists existing leads after this issue - [test: seller route regression test]
- [ ] `pnpm test` exits 0 - [command: `pnpm test`]
- [ ] `pnpm build` exits 0 - [command: `pnpm build`]

## How to verify

1. Run the database migration for the new chat/session and analytics storage locally.
2. Run the render/unit tests for generated pages and structured metadata.
3. Start the local app and open a representative generated page with contact data.
4. Confirm direct contact UI is gone, non-contact page context remains, and "Zapytaj asystenta" opens the chat shell.
5. Start a chat and inspect local D1 for the created session/event rows.
6. Run the Telegram mocked notification test and confirm the start notification payload.
7. Run `pnpm test`.
8. Run `pnpm build`.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 5
- User story 12
- User story 13
- User story 14
- User story 24
- User story 26
- User story 27
- User story 28
