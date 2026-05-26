# PRD: AI assistant chat for generated business pages

## Problem Statement

Generated business pages can attract visitors, but many business owners are not yet interested in paying for or maintaining a website. Showing direct contact details sends the visitor away and gives the project little evidence that the generated page created demand.

The product needs a v1 flow that captures visitor engagement on the generated page without claiming the page belongs to the business owner. The first goal is demand validation: measure whether visitors start a conversation with an AI assistant and what kinds of specific requests they make.

## Solution

Replace direct contact-style UI on generated public pages with a Polish CTA button: **"Zapytaj asystenta"**.

The button opens an on-site AI chat. The assistant answers using only the generated page content and existing business metadata stored in the database. It must not claim to represent the business. If a visitor asks for something actionable or uncertain, the assistant gives a helpful explanation and directs the visitor toward official human/business channels without exposing direct phone/email/link contact details.

Every chat session is stored in the database. Telegram notifications are sent when a chat starts and when a chat ends. The end notification includes a concise intent summary, message count, and transcript link using the existing seller/admin deep link. For v1, the internal `seller` convention remains as a compatibility layer, even though the long-term product language should move away from "seller".

## User Stories

1. As a visitor, I want to see a clear "Zapytaj asystenta" button instead of direct contact details, so that I can ask questions without leaving the page.
2. As a visitor, I want the generated page to keep useful public context like address, opening hours, map, description, and services, so that the page remains useful before I open chat.
3. As a visitor, I want the chat to open without changing the page's current look and feel, so that the experience feels native to the generated page.
4. As a visitor, I want the assistant to greet me in Polish, so that the flow matches the target audience.
5. As a visitor, I want the assistant to disclose that it does not directly represent the business, so that I understand who I am speaking with.
6. As a visitor, I want to ask natural follow-up questions, so that the chat feels helpful rather than like a rigid form.
7. As a visitor, I want the assistant to answer from known page/business data, so that answers are grounded in available information.
8. As a visitor, I want the assistant to say when it does not know an answer, so that I am not misled by guesses.
9. As a visitor, I want the assistant to explain when a matter requires a human/business channel, so that I know what to do next for booking, pricing, availability, complaints, job requests, and similar requests.
10. As a visitor, I want the assistant not to expose phone numbers, email addresses, or direct contact links, so that the experience stays inside the assistant flow.
11. As a visitor, I want the assistant to still provide address and opening-hours context when available, so that refusing direct contact details does not make the answer useless.
12. As a visitor, I want a minimal privacy notice near the chat input, so that I know the conversation is AI-handled and may be stored.
13. As the site operator, I want every chat start to be stored, so that chat start rate can be measured against page visits.
14. As the site operator, I want a Telegram notification when a chat starts, so that I know which pages are receiving engagement.
15. As the site operator, I want chat messages, page/business slug, timestamps, referrer, and user agent stored, so that I can analyze demand patterns without aggressive visitor identification.
16. As the site operator, I want an explicit "end chat" action, so that visitors can end a session intentionally.
17. As the site operator, I want inactive chats to end automatically after a conservative timeout, so that abandoned sessions still produce end summaries.
18. As the site operator, I want browser/tab close handling to be best-effort only, so that unreliable close events do not become the source of truth.
19. As the site operator, I want a Telegram notification when a chat ends, so that I receive a summary without monitoring the database manually.
20. As the site operator, I want the end notification to include business/page slug, intent summary, message count, and transcript link, so that I can quickly judge whether the session is useful evidence.
21. As the site operator, I want transcript links to use the existing seller/admin deep link, so that v1 avoids building a separate review surface.
22. As the site operator, I want chats categorized by specific intent, so that I can later show business owners what visitors wanted.
23. As the site operator, I want complaints tracked separately from commercial demand, so that pitch evidence is not mixed with support/risk evidence.
24. As the site operator, I want chat start rate per page visit to be the primary success metric, so that v1 validates whether visitors will engage with the assistant.
25. As the site operator, I want supporting metrics such as message count, specific-intent chats, and repeated demand by business, so that the validation signal is richer than a single conversion rate.
26. As the site operator, I want visible UI and structured metadata to remove phone/email/contact URL exposure, so that the public page behavior is consistent.
27. As the site operator, I want address and opening-hours structured data preserved, so that useful local context and SEO value remain.
28. As a future product owner, I want internal `seller` naming left untouched for v1, so that the chat experiment does not expand into a full domain rename.

## Implementation Decisions

- **Public positioning:** Generated pages are independent directory/AI concierge pages, not official business websites. No visitor-facing copy should imply the page belongs to the business owner.
- **Primary business outcome:** v1 optimizes for demand validation, not monetization, lead resale, or owned-channel growth.
- **Primary metric:** Chat start rate per page visit.
- **Entry point:** Replace existing direct contact area with a button labeled **"Zapytaj asystenta"**.
- **Visible page data:** Hide direct contact details, but keep useful public context visible, including address, opening hours, map, business description, services, and similar content.
- **Structured data:** Keep address/opening-hours schema. Remove phone, email, and contact URL fields from structured metadata and visible UI.
- **Chat channel:** Web chat only. No email, SMS, WhatsApp, Messenger, Telegram, or app-account capture for visitors in v1.
- **Initial assistant message:** "Cześć! Jestem asystentem AI i nie reprezentuję bezpośrednio tego miejsca. Zapytaj mnie o to miejsce — jeśli sprawa wymaga kontaktu z człowiekiem, podpowiem Ci najlepszy następny krok."
- **Privacy notice:** "Rozmowa jest obsługiwana przez asystenta AI i może zostać zapisana, aby poprawiać jakość odpowiedzi."
- **Knowledge boundary:** The assistant may use generated site/page content plus existing business metadata in the database. No live web search in v1.
- **Unknown-answer behavior:** If the assistant does not know from allowed data, it says it does not know and suggests using official human/business channels.
- **Action/contact behavior:** For booking, reservations, pricing, availability, complaints, job requests, and contact-detail requests, the assistant gives a helpful explanation and directs the visitor to official human/business channels. It must not claim it can book, confirm, negotiate, change, complain on behalf of the visitor, or represent the business.
- **Direct contact suppression:** The assistant must not provide phone numbers, email addresses, or direct contact links, even if they exist in the database. It may provide address/opening-hours context when available.
- **Session start:** Every new chat session is stored and triggers a Telegram "chat started" notification with business/page slug, timestamp, and referrer.
- **Session storage:** Store chat messages, page/business slug, timestamps, referrer, and user agent. Do not intentionally collect visitor contact details or perform aggressive visitor identification in v1.
- **Session end:** A chat ends when the visitor clicks an explicit end action or when inactivity exceeds a conservative timeout. Use 30 minutes as the initial timeout, then adjust using analytics after launch.
- **Browser close:** Treat browser/tab close detection as best-effort only.
- **End notification:** Telegram "chat ended" notification includes business/page slug, intent summary, message count, and transcript link.
- **Transcript link:** Use the existing seller/admin deep link. There is currently one seller acting as admin.
- **Internal naming:** Keep existing `seller` naming/routes internally for v1. Only visitor-facing language changes.
- **Intent taxonomy:** Specific intent includes booking/reservation, quote/pricing, availability, complaint, job request, and contact-detail request.
- **Complaint handling:** Track complaints separately from commercial demand.
- **Telegram noise control:** Do not send full message-by-message real-time notifications in v1.

## Assumptions

- Generated public pages currently do not state that they belong to the business owner.
- The current templates contain a direct contact area that can be replaced without redesigning the entire page.
- Existing business metadata in the database is sufficient for a useful first assistant version.
- Existing page visit tracking either exists or can be added so chat start rate per page visit can be calculated.
- The project has or can add a Telegram bot/channel configuration for operator notifications.
- The existing seller/admin deep link can address a stored chat transcript or can be extended narrowly to do so.
- There is currently one seller/admin, so v1 does not need multi-operator routing.
- Visitors are Polish-speaking; visitor-facing chat UI and assistant copy should be Polish-first.
- Basic privacy policy coverage either already exists or will be updated to match chat storage before public launch.
- Visitors may voluntarily type personal data, so stored transcripts should be treated as potentially containing personal data.
- Business owners have not consented to the assistant representing them; therefore the assistant must not imply agency or direct representation.
- The first validation cohort does not require live human replies inside the same chat.

## Tradeoffs Considered

- **Off-site channel capture first** — rejected for v1 because the first validation question is whether visitors start chats at all.
- **Email/SMS/WhatsApp capture** — rejected for v1 because it adds consent, deliverability, and trust friction before demand is validated.
- **Live web search** — rejected for v1 because it increases latency, cost, and risk of stale or unverified answers.
- **Providing direct phone/email from the database** — rejected because it sends visitors away and weakens the channel-capture experiment.
- **Hiding all business details behind chat** — rejected because the page would become less useful and likely reduce visitor trust.
- **Real-time Telegram notifications for every message** — rejected because it would spam the operator and is not needed for validation.
- **Blocking consent checkbox before chat** — rejected because a minimal inline privacy notice is more appropriate for a low-friction validation flow.
- **Full migration away from `seller` naming now** — rejected because it would expand scope beyond the v1 chat experiment.
- **Browser/tab close as the authoritative end event** — rejected because close detection is unreliable.
- **No disclosure that the assistant does not represent the business** — rejected because it creates trust and misrepresentation risk.

## Validation Strategy

- **US-1:** Render a generated page with prior contact data. Verify visible phone/email/contact links are absent and the CTA text is exactly "Zapytaj asystenta".
- **US-2:** Render representative templates. Verify address, opening hours, map, description, and service content remain visible where those fields exist.
- **US-3:** Visual regression or screenshot review confirms the chat CTA and opened chat fit the current template styling on desktop and mobile without layout overlap.
- **US-4:** Open chat and verify the first assistant-visible text is Polish.
- **US-5:** Open chat and verify the first assistant message includes that the assistant does not directly represent the place.
- **US-6:** Send at least two follow-up visitor messages in one session and verify the assistant keeps context within that session.
- **US-7:** Ask a question answerable from page/business metadata and verify the answer uses only allowed stored data.
- **US-8:** Ask a question not present in allowed data and verify the assistant says it does not know rather than guessing.
- **US-9:** Ask booking, pricing, availability, complaint, job request, and action-oriented prompts. Verify each response gives helpful guidance and points to human/business channels without claiming action was completed.
- **US-10:** Ask for phone, email, and contact link. Verify none are returned.
- **US-11:** Ask for location/hours after asking for contact details. Verify address/opening-hours context is still returned when available.
- **US-12:** Open chat UI and verify the privacy notice text appears near the input: "Rozmowa jest obsługiwana przez asystenta AI i może zostać zapisana, aby poprawiać jakość odpowiedzi."
- **US-13:** Start a chat and verify a session record is created with a start timestamp and page/business slug.
- **US-14:** Start a chat and verify a Telegram start notification contains slug, timestamp, and referrer.
- **US-15:** Send messages from a page with a referrer and user agent. Verify stored records include messages, slug, timestamps, referrer, and user agent, and do not require visitor contact details.
- **US-16:** Click explicit end action and verify session status changes to ended.
- **US-17:** Simulate inactivity beyond the configured timeout and verify session status changes to ended. Initial timeout configuration should be 30 minutes.
- **US-18:** Close/reload the tab and verify the system does not rely exclusively on that event to produce an ended session.
- **US-19:** End a chat and verify one Telegram end notification is sent.
- **US-20:** End a chat and verify the Telegram end notification contains slug, intent summary, message count, and transcript link.
- **US-21:** Open the transcript link from Telegram and verify it resolves through the existing seller/admin deep link for the stored chat session.
- **US-22:** Run representative transcripts through intent classification. Verify booking/reservation, quote/pricing, availability, complaint, job request, and contact-detail request are classified distinctly.
- **US-23:** Verify complaint sessions are flagged separately from commercial demand in stored summary data.
- **US-24:** Visit a page, start chat, and verify analytics can compute chat starts divided by page visits for that page.
- **US-25:** End multiple sessions and verify supporting metrics can be derived: message count, specific-intent count, and repeated demand by business/page.
- **US-26:** Inspect rendered HTML and structured metadata. Verify phone, email, and contact URL fields are absent from visible UI and JSON-LD/metadata.
- **US-27:** Inspect structured metadata. Verify address and opening-hours schema remain present when source data exists.
- **US-28:** Verify existing seller routes still work and no v1 user-facing Polish copy uses "seller" as the concept.

### Done Criteria

- All user stories above have a passing manual or automated validation path.
- No visitor-facing page or chat copy implies the assistant represents the business owner.
- Direct phone, email, and contact URL exposure is removed from visible UI and structured metadata.
- Chat start and chat end both produce stored records and Telegram notifications.
- Chat start rate per page visit can be calculated for each generated page.
- Transcript link in the end notification opens the existing seller/admin review path.

## Out of Scope

- Selling leads back to business owners.
- Visitor email/SMS/WhatsApp/Messenger/Telegram capture.
- Visitor accounts or mobile push notifications.
- Live operator replies inside the same chat.
- Business owner portal or business-owner self-service.
- Full rename/migration from `seller` to `admin`, `operator`, or another domain term.
- Live web search.
- Showing direct phone/email/contact links through the assistant.
- Message-by-message Telegram streaming.
- Advanced identity tracking, fingerprinting, or cross-site visitor profiles.

## Further Notes

- The current product direction is moving away from "seller"; keep it internally for v1 only to control scope.
- Future versions may add an operator console, explicit lead products, business-owner pitch reports, or an owned consumer communication channel after chat engagement is validated.
- Complaints can be useful evidence but should be handled carefully because they may create a support or reputation-management obligation rather than a sales opportunity.
