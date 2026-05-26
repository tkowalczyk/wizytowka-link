## Parent PRD

#43

## Type

AFK

## What to build

Extend the chat shell into a stored multi-turn conversation.

Visitor messages and assistant responses are persisted with their session. The assistant answers from allowed context only: generated page content and DB business metadata. If the answer is not available from that context, it says it does not know and points the visitor toward official human/business channels. It must not guess.

For direct contact requests, the assistant must not expose phone numbers, email addresses, or direct contact links, even when stored data contains them. It may still provide address and opening-hours context when available. For actionable requests such as booking, pricing, availability, complaints, and job requests, it gives a brief helpful explanation and tells the visitor the matter requires a human/business channel.

Plan reference: `plans/ai-asystent-chat-generowane-strony.md`, Phase 2.

## Assumptions

- Phase 1 session creation works.
- The chat client can call a server endpoint with a session identifier.
- Business/page data can be loaded by slug or related durable identifier.
- The project will use the existing or selected LLM integration path available at implementation time, but the prompt and guardrails are part of this issue.

## Out of scope for this issue

- Do not add session ending or end Telegram notifications.
- Do not add intent classification summaries.
- Do not build an admin transcript page.
- Do not add live web search.
- Do not add a human operator reply loop.

## Acceptance criteria

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

## How to verify

1. Complete or check out the implementation for #44.
2. Run local migrations so `chat_sessions` and `chat_messages` are available.
3. Start a chat from a generated page and send two visitor messages.
4. Inspect local D1 and confirm visitor and assistant messages were persisted with the correct session linkage.
5. Run the guardrail fixture tests for known-data answers, unknown answers, direct contact requests, and actionable requests.
6. Run `pnpm test`.
7. Run `pnpm build`.

## Blocked by

- Blocked by #44

## User stories addressed

- User story 6
- User story 7
- User story 8
- User story 9
- User story 10
- User story 11
- User story 15
