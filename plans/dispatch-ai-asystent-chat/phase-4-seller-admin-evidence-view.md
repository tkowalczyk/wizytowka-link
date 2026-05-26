## Parent PRD

#43

## Type

AFK

## What to build

Make stored chat evidence reviewable through the existing seller/admin path.

Telegram transcript links should resolve through the current seller/admin deep-link convention. The seller/admin view exposes the transcript, session metadata, and validation signals needed to judge demand: chat start rate per page visit, message count, specific-intent count, repeated demand by business/page, and separate complaint signal.

This issue keeps `seller` as the internal compatibility layer. Visitor-facing labels should use neutral/admin/assistant language, not "seller".

Plan reference: `plans/ai-asystent-chat-generowane-strony.md`, Phase 4.

## Assumptions

- Phases 1-3 store sessions, messages, and summaries.
- Existing seller/admin authentication remains token-based.
- Page visit and chat-start event data exist for computing chat start rate.

## Out of scope for this issue

- Do not add live reply capability from the seller/admin panel.
- Do not build a business-owner-facing portal.
- Do not add export or report generation.
- Do not rename existing seller route names.

## Acceptance criteria

- [ ] Telegram transcript link opens a protected seller/admin route for the corresponding chat session - [test: route integration test]
- [ ] Invalid or unauthorized transcript access returns 404 or equivalent non-disclosing response - [test: route authorization test]
- [ ] Transcript view shows visitor and assistant messages in chronological order - [test: transcript render test]
- [ ] Transcript view shows page/business slug, start timestamp, end timestamp, referrer, user agent, end reason, message count, and intent summary - [test: transcript render test]
- [ ] Seller/admin evidence view can compute chat start rate as chat starts divided by page visits for a page/business slug - [test: analytics query unit test]
- [ ] Evidence view exposes supporting metrics: total chats, average/total message count, specific-intent count, repeated demand by business/page, complaint count separated from commercial demand - [test: analytics query unit test]
- [ ] Existing lead list behavior in the seller/admin route still works after adding transcript/evidence access - [test: seller panel regression test]
- [ ] No visitor-facing copy introduced in this issue uses "seller" as a concept - [test: rendered public copy scan]
- [ ] `pnpm test` exits 0 - [command: `pnpm test`]
- [ ] `pnpm build` exits 0 - [command: `pnpm build`]

## How to verify

1. Complete or check out the implementation for #46.
2. Seed at least one ended chat session with messages, summary, referrer, user agent, and analytics events.
3. Open the transcript link through the existing seller/admin token path and confirm the transcript and metadata render.
4. Try an invalid or unauthorized transcript link and confirm it does not disclose whether the transcript exists.
5. Run analytics query tests for chat start rate, message counts, specific-intent counts, repeated demand, and separated complaint counts.
6. Run existing seller/admin lead list regression tests.
7. Run `pnpm test`.
8. Run `pnpm build`.

## Blocked by

- Blocked by #46

## User stories addressed

- User story 21
- User story 24
- User story 25
- User story 28
