# Plan: AI assistant chat for generated business pages

> Source PRD: tkowalczyk/wizytowka-link#43, local copy `plans/prd-ai-asystent-chat-generowane-strony.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Architecture style**: Astro on Cloudflare Workers, with public generated pages, server-side API endpoints, D1 persistence, R2-backed generated site content, and existing Telegram notification utilities.
- **Data model**: Add persistent chat/session data without changing the existing `seller` compatibility model. Core data should separate session metadata from individual messages and derived summaries.
- **Key entities**: `chat_sessions`, `chat_messages`, page visit/chat start events, business/page slug, seller/admin transcript deep link, intent summary, specific-intent category, complaint flag.
- **Integrations**: Telegram Bot API for operator start/end notifications; existing seller/admin private route for transcript access; existing page/business data sources for assistant context.
- **Assistant boundary**: The assistant may use generated page content and existing DB business metadata only. No live web search in v1.
- **Trust boundary**: Visitor-facing copy must never imply that the assistant or generated page represents the business owner.
- **Contact suppression**: Direct phone, email, and contact URL must be absent from visible public UI, structured metadata, and assistant responses. Address and opening-hours context can remain available.
- **Primary metric**: Chat start rate per generated page visit.
- **Internal naming**: Keep existing `seller` routes and internal naming for v1. Only visitor-facing language changes.
- **Initial inactivity timeout**: 30 minutes, adjustable later from analytics.

---

## Phase 1: Public-page chat start tracer

**User stories**: 1, 2, 3, 4, 5, 12, 13, 14, 24, 26, 27, 28

### What to build

Deliver the thinnest end-to-end path from a generated public page visit to a stored chat session and Telegram start notification.

The public page replaces its direct contact area with a button labeled **"Zapytaj asystenta"**. Existing useful page context stays visible: address, opening hours, map, description, services, and similar non-contact content. Visible UI and structured metadata remove direct phone, email, and contact URL exposure while preserving address/opening-hours metadata.

Clicking the button opens a Polish chat shell with the approved first message and minimal privacy notice. Opening the chat creates a stored session, records enough analytics to compute chat start rate per page visit, and sends a Telegram "chat started" notification with business/page slug, timestamp, and referrer.

### Assumptions carried in

- Generated page content and business metadata already exist.
- A seller/admin notification target already exists or can be resolved through current seller data.
- Existing seller routes remain unchanged.
- No assistant LLM response is required in this phase beyond the static first message.

### Out of scope for this phase

- No multi-turn AI conversation.
- No visitor message persistence beyond the created session shell.
- No end-chat behavior.
- No transcript view beyond a stored session identifier.
- No full `seller` naming migration.

### Acceptance criteria

- [ ] A generated page with prior phone/contact data renders no visible phone number, email, `tel:` link, `mailto:` link, or contact URL, and renders a single CTA labeled "Zapytaj asystenta" - [test: generated page render test]
- [ ] Address, opening hours, map/location context, description, and services remain visible when source data exists - [test: generated page render test]
- [ ] LocalBusiness structured metadata omits phone/email/contact URL while preserving address and opening-hours data when available - [test: structured metadata unit test]
- [ ] Opening chat shows the first message: "Cześć! Jestem asystentem AI i nie reprezentuję bezpośrednio tego miejsca. Zapytaj mnie o to miejsce - jeśli sprawa wymaga kontaktu z człowiekiem, podpowiem Ci najlepszy następny krok." - [test: chat UI render test]
- [ ] Chat input area shows the privacy notice: "Rozmowa jest obsługiwana przez asystenta AI i może zostać zapisana, aby poprawiać jakość odpowiedzi." - [test: chat UI render test]
- [ ] Starting chat creates a stored session with page/business slug, start timestamp, referrer, user agent, and active status - [observable: `chat_sessions` row]
- [ ] Starting chat records a chat-start event that can be joined to page-visit events by page/business slug - [observable: analytics/event rows]
- [ ] Starting chat sends one Telegram start notification containing slug, timestamp, and referrer - [test: Telegram fetch mock assertion]
- [ ] Existing seller/admin route still authenticates and lists existing leads after this phase - [test: seller route regression test]
- [ ] `pnpm test` exits 0 - [command: `pnpm test`]
- [ ] `pnpm build` exits 0 - [command: `pnpm build`]

---

## Phase 2: Grounded conversation loop

**User stories**: 6, 7, 8, 9, 10, 11, 15

### What to build

Extend the chat shell into a stored multi-turn conversation.

Visitor messages and assistant responses are persisted with their session. The assistant answers from allowed context only: generated page content and DB business metadata. If the answer is not available from that context, it says it does not know and points the visitor toward official human/business channels. It must not guess.

For direct contact requests, the assistant must not expose phone numbers, email addresses, or direct contact links, even when stored data contains them. It may still provide address and opening-hours context when available. For actionable requests such as booking, pricing, availability, complaints, and job requests, it gives a brief helpful explanation and tells the visitor the matter requires a human/business channel.

### Assumptions carried in

- Phase 1 session creation works.
- The chat client can call a server endpoint with a session identifier.
- Business/page data can be loaded by slug or related durable identifier.
- The project will use the existing or selected LLM integration path available at implementation time, but the prompt and guardrails are part of this phase.

### Out of scope for this phase

- No session ending or end Telegram notification.
- No intent classification summary.
- No admin transcript page.
- No live web search.
- No human operator reply loop.

### Acceptance criteria

- [ ] Sending a visitor message stores the message with session id, role, content, and timestamp - [observable: `chat_messages` row]
- [ ] Assistant responses are stored with session id, role, content, and timestamp - [observable: `chat_messages` row]
- [ ] A two-message visitor conversation preserves session context in the assistant response - [test: chat API integration test]
- [ ] A question answerable from generated page/DB business metadata receives an answer grounded in that data - [test: prompt/response integration test with deterministic fixture or mocked model]
- [ ] A question not answerable from allowed data receives an "I do not know" style response and no guessed fact - [test: prompt/response guardrail test]
- [ ] Requests for phone, email, or direct contact links never return stored phone/email/contact URL values - [test: contact suppression guardrail test]
- [ ] After a direct contact request, the assistant may return known address/opening-hours context when available - [test: allowed context response test]
- [ ] Booking/reservation, pricing, availability, complaint, and job-request prompts each receive a helpful human-channel guidance response and no claim of completed action - [test: action-intent guardrail matrix]
- [ ] Stored message metadata includes page/business slug linkage, timestamps, referrer, and user agent through the session - [observable: joined session/message query]
- [ ] `pnpm test` exits 0 - [command: `pnpm test`]
- [ ] `pnpm build` exits 0 - [command: `pnpm build`]

---

## Phase 3: Session end and intent summaries

**User stories**: 16, 17, 18, 19, 20, 22, 23

### What to build

Complete the chat lifecycle.

Visitors can explicitly end a chat. Inactive sessions end automatically after the configured timeout, initially 30 minutes. Browser/tab close may send a best-effort signal, but the durable source of truth is explicit end or timeout.

When a session ends, the system derives an intent summary, message count, and specific-intent categories. Specific intents include booking/reservation, quote/pricing, availability, complaint, job request, and contact-detail request. Complaints are tracked separately from commercial demand. The system sends a Telegram "chat ended" notification with slug, intent summary, message count, and transcript link.

### Assumptions carried in

- Phase 2 persists complete conversations.
- A seller/admin transcript link format can be generated even if the detail view is completed in Phase 4.
- Telegram start notifications already work and can share the same delivery utility.

### Out of scope for this phase

- No rich transcript UI.
- No business-owner pitch report.
- No real-time Telegram message stream.
- No multi-operator routing.

### Acceptance criteria

- [ ] Clicking explicit end changes session status to ended and stores ended timestamp/end reason - [test: chat end API integration test]
- [ ] A session inactive beyond the configured timeout is marked ended with timeout reason - [test: timeout job/unit test with simulated clock]
- [ ] The initial inactivity timeout is configured as 30 minutes - [test: configuration unit test]
- [ ] Browser/tab close handling is best-effort only and does not replace timeout-based ending - [test: lifecycle regression test]
- [ ] Ending a session computes message count from stored messages - [observable: ended session summary field]
- [ ] Ending a session stores an intent summary - [observable: ended session summary field]
- [ ] Booking/reservation, quote/pricing, availability, complaint, job request, and contact-detail request transcripts classify into distinct categories - [test: intent classifier fixture matrix]
- [ ] Complaint sessions are flagged separately from commercial-demand sessions - [test: intent classifier fixture matrix]
- [ ] Ending a session sends one Telegram end notification containing slug, intent summary, message count, and transcript link - [test: Telegram fetch mock assertion]
- [ ] Re-ending an already ended session does not send duplicate Telegram end notifications - [test: idempotency integration test]
- [ ] `pnpm test` exits 0 - [command: `pnpm test`]
- [ ] `pnpm build` exits 0 - [command: `pnpm build`]

---

## Phase 4: Seller/admin evidence view

**User stories**: 21, 24, 25, 28

### What to build

Make stored chat evidence reviewable through the existing seller/admin path.

Telegram transcript links should resolve through the current seller/admin deep-link convention. The seller/admin view exposes the transcript, session metadata, and validation signals needed to judge demand: chat start rate per page visit, message count, specific-intent count, repeated demand by business/page, and separate complaint signal.

This phase keeps `seller` as the internal compatibility layer. Visitor-facing labels should use neutral/admin/assistant language, not "seller".

### Assumptions carried in

- Phases 1-3 store sessions, messages, and summaries.
- Existing seller/admin authentication remains token-based.
- Page visit and chat-start event data exist for computing chat start rate.

### Out of scope for this phase

- No live reply capability from the seller/admin panel.
- No business-owner-facing portal.
- No export/report generator.
- No rename of existing seller route names.

### Acceptance criteria

- [ ] Telegram transcript link opens a protected seller/admin route for the corresponding chat session - [test: route integration test]
- [ ] Invalid or unauthorized transcript access returns 404 or equivalent non-disclosing response - [test: route authorization test]
- [ ] Transcript view shows visitor and assistant messages in chronological order - [test: transcript render test]
- [ ] Transcript view shows page/business slug, start timestamp, end timestamp, referrer, user agent, end reason, message count, and intent summary - [test: transcript render test]
- [ ] Seller/admin evidence view can compute chat start rate as chat starts divided by page visits for a page/business slug - [test: analytics query unit test]
- [ ] Evidence view exposes supporting metrics: total chats, average/total message count, specific-intent count, repeated demand by business/page, complaint count separated from commercial demand - [test: analytics query unit test]
- [ ] Existing lead list behavior in the seller/admin route still works after adding transcript/evidence access - [test: seller panel regression test]
- [ ] No visitor-facing copy introduced in this phase uses "seller" as a concept - [test: rendered public copy scan]
- [ ] `pnpm test` exits 0 - [command: `pnpm test`]
- [ ] `pnpm build` exits 0 - [command: `pnpm build`]

---

## Phase 5: Launch verification slice

**User stories**: all PRD stories, with emphasis on regression coverage and release readiness

### What to build

Run and fill gaps in the end-to-end release checklist before launch.

This phase verifies the complete visitor path across representative generated templates and devices: page view, hidden direct contact details, assistant start, message exchange, safe unknown/contact behavior, explicit end, timeout end, Telegram notifications, transcript link, seller/admin evidence view, and metric calculation.

It also verifies policy and trust surfaces: privacy notice, privacy policy coverage, no business-representation claims, no direct contact leaks in visible UI or metadata, and no accidental public exposure of transcripts.

### Assumptions carried in

- Phases 1-4 are implemented and individually tested.
- Representative generated pages are available locally or in a staging-like environment.
- Telegram calls can be tested through mocks locally and through a controlled real notification target before production.

### Out of scope for this phase

- No new product behavior beyond fixes required to satisfy the PRD.
- No monetization workflow.
- No off-site visitor channel capture.
- No business-owner pitch report.

### Acceptance criteria

- [ ] Desktop and mobile screenshots of representative generated templates show no incoherent overlap and preserve current look and feel with the chat CTA - [observable: screenshot artifacts]
- [ ] End-to-end smoke test covers page visit -> "Zapytaj asystenta" -> session start -> Telegram start -> visitor message -> assistant response -> explicit end -> Telegram end -> transcript link - [test: browser/e2e smoke test]
- [ ] Timeout smoke test covers page visit -> chat start -> inactivity beyond configured threshold -> ended session -> Telegram end notification - [test: integration test with simulated clock]
- [ ] Direct contact leak scan finds no visible `tel:`, `mailto:`, phone, email, or contact URL in generated public pages and structured metadata - [test: rendered HTML/metadata scan]
- [ ] Assistant guardrail fixture suite passes for unknown answers, phone/email requests, booking/reservation, quote/pricing, availability, complaints, and job requests - [test: guardrail fixture suite]
- [ ] Privacy notice is visible near the chat input on desktop and mobile - [test: browser/e2e assertion]
- [ ] Privacy policy or launch checklist explicitly covers AI chat storage before public launch - [observable: policy checklist item marked done]
- [ ] Transcript routes are not indexable and require seller/admin access - [test: route metadata and authorization tests]
- [ ] Chat start rate can be calculated for at least one generated page from stored events - [observable: analytics query result]
- [ ] `pnpm lint` exits 0 - [command: `pnpm lint`]
- [ ] `pnpm types` exits 0 - [command: `pnpm types`]
- [ ] `pnpm test` exits 0 - [command: `pnpm test`]
- [ ] `pnpm build` exits 0 - [command: `pnpm build`]
