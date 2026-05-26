## Parent PRD

#43

## Type

AFK

## What to build

Complete the chat lifecycle.

Visitors can explicitly end a chat. Inactive sessions end automatically after the configured timeout, initially 30 minutes. Browser/tab close may send a best-effort signal, but the durable source of truth is explicit end or timeout.

When a session ends, the system derives an intent summary, message count, and specific-intent categories. Specific intents include booking/reservation, quote/pricing, availability, complaint, job request, and contact-detail request. Complaints are tracked separately from commercial demand. The system sends a Telegram "chat ended" notification with slug, intent summary, message count, and transcript link.

Plan reference: `plans/ai-asystent-chat-generowane-strony.md`, Phase 3.

## Assumptions

- Phase 2 persists complete conversations.
- A seller/admin transcript link format can be generated even if the detail view is completed in Phase 4.
- Telegram start notifications already work and can share the same delivery utility.

## Out of scope for this issue

- Do not build a rich transcript UI.
- Do not build a business-owner pitch report.
- Do not add real-time Telegram message streaming.
- Do not add multi-operator routing.

## Acceptance criteria

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

## How to verify

1. Complete or check out the implementation for #45.
2. Start a chat, send enough messages to create an intent, and click the explicit end action.
3. Inspect local D1 and confirm the session is ended with ended timestamp, end reason, message count, intent summary, and specific-intent fields.
4. Run the timeout test with a simulated clock and confirm timeout-ended sessions get an end notification once.
5. Run the intent fixture matrix and confirm complaint sessions are separated from commercial demand.
6. Run the Telegram mocked notification test and confirm the end notification payload.
7. Run `pnpm test`.
8. Run `pnpm build`.

## Blocked by

- Blocked by #45

## User stories addressed

- User story 16
- User story 17
- User story 18
- User story 19
- User story 20
- User story 22
- User story 23
