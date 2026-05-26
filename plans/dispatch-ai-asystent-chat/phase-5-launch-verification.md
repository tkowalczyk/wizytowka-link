## Parent PRD

#43

## Type

AFK

## What to build

Run and fill gaps in the end-to-end release checklist before launch.

This issue verifies the complete visitor path across representative generated templates and devices: page view, hidden direct contact details, assistant start, message exchange, safe unknown/contact behavior, explicit end, timeout end, Telegram notifications, transcript link, seller/admin evidence view, and metric calculation.

It also verifies policy and trust surfaces: privacy notice, privacy policy coverage, no business-representation claims, no direct contact leaks in visible UI or metadata, and no accidental public exposure of transcripts.

Plan reference: `plans/ai-asystent-chat-generowane-strony.md`, Phase 5.

## Assumptions

- Phases 1-4 are implemented and individually tested.
- Representative generated pages are available locally or in a staging-like environment.
- Telegram calls can be tested through mocks locally and through a controlled real notification target before production.

## Out of scope for this issue

- Do not add new product behavior beyond fixes required to satisfy the PRD.
- Do not add monetization workflow.
- Do not add off-site visitor channel capture.
- Do not build a business-owner pitch report.

## Acceptance criteria

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

## How to verify

1. Complete or check out the implementations for #44, #45, #46, and #47.
2. Run local migrations and seed representative generated pages with contact data.
3. Run the browser/e2e smoke test for the full chat lifecycle.
4. Run the timeout smoke test with a simulated clock.
5. Run the direct contact leak scan against rendered HTML and structured metadata.
6. Run the assistant guardrail fixture suite.
7. Confirm screenshot artifacts exist for desktop and mobile representative templates.
8. Confirm the privacy policy or launch checklist covers AI chat storage.
9. Run `pnpm lint`.
10. Run `pnpm types`.
11. Run `pnpm test`.
12. Run `pnpm build`.

## Blocked by

- Blocked by #47

## User stories addressed

- All PRD user stories, with emphasis on regression coverage and release readiness.
