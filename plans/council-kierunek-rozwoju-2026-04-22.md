# LLM Council: Kierunek rozwoju wizytowka-link

**Data:** 2026-04-22
**Pytanie:** Jaki powinien być następny duży krok rozwoju wizytowka-link?

---

## Sformułowane pytanie

Wizytowka-link to platforma lead-gen dla polskich firm lokalnych: automatycznie scrapuje biznesy przez SerpAPI, generuje statyczne strony-wizytówki na Cloudflare, a leady przekazuje sprzedawcom przez panel + Telegram.

**Stan obecny:** 95k lokalizacji TERYT, 4 crony (geocoder, preflight, discovery, generacja stron), panel sprzedawcy (filtrowanie, triaging leadów), 3 boty Telegram, SSR generacja stron z 8 paletami × 3 style × 3 layouty. Dojrzała architektura (D1/R2/Workers), 20 ukończonych design docs. Brak widocznego modelu monetyzacji.

**Pytanie:** Gdzie zainwestować czas — w skalowanie pipeline'u (więcej lokalizacji/kategorii), w monetyzację (billing, premium features), w wartość dla biznesu (edycja stron, analytics, CRM), czy w zupełnie inny kierunek?

---

## Odpowiedzi doradców

### The Contrarian

The fatal flaw is that you have no proof anyone will pay for this.

You've built an impressive machine that manufactures a product nobody has agreed to buy. 95k localities, 4 crons, 3 Telegram bots, 8 palettes — this is engineering in search of a business model, and that's a dangerous place to be.

Specific failure modes to investigate before building anything else:

**Consent and legal exposure.** You're scraping Polish businesses via SerpAPI and generating sites *about them* without their knowledge. GDPR Article 6 requires a lawful basis for processing. "Legitimate interest" is your likely defense, but it's contested ground for lead-gen. One DPA complaint from a hostile business owner could force you to delete records at scale. Do you have a deletion workflow?

**The cold-start sales problem is brutal.** Sellers get leads via Telegram. What's the current conversion rate from "lead surfaced" to "deal closed"? If it's unknown, you don't have a business — you have a demo. Every new feature you build before validating this is waste.

**SerpAPI dependency is a single point of death.** Your preflight cron exists precisely because quota is a constraint. If SerpAPI changes pricing or terms, your entire discovery pipeline collapses. There's no fallback.

**The real question you're avoiding:** Have any sellers actually paid you money? If not, that's the only thing that matters right now. Not scaling to more localities. Not more palette variants. Not CRM features.

Build billing first — not because it's the most interesting problem, but because without it you'll never know if the rest of the machine is worth running.

### The First Principles Thinker

The question assumes the platform needs to grow in one of four directions. That assumption deserves scrutiny.

**What are you actually building?** Right now wizytowka-link is a data pipeline with a sales interface bolted on. Scrape → generate → notify seller → seller calls business. The "product" is a list of phone numbers with context.

The root problem underneath the question: **you don't yet have proof that sellers convert leads into revenue at a rate that justifies the infrastructure complexity.** Until you do, every investment — more localities, billing systems, CRM, analytics — is building on unvalidated ground.

Strip it back: what's the actual conversion funnel?

1. Business gets discovered
2. Seller is notified
3. Seller contacts business
4. Business pays for something
5. Repeat

Where does it break? You almost certainly don't know, because there's no instrumentation on steps 3-5. The `call_log` table exists but what does it actually capture? Outcome data is the missing primitive.

**The real next step** isn't scaling or monetization features — it's closing the feedback loop. Build the minimal mechanism to capture: did the seller reach the business? Did the business express interest? Did money change hands?

Without that data, you're optimizing a funnel you can't see.

The wrong question is "which direction to scale." The right question is: **"Does this pipeline produce outcomes worth paying for, and how would we know?"**

### The Expansionist

The infrastructure you've built is a **lead-generation OS**, not a product. That distinction is the unlock.

You have 95k localities, deterministic site generation, and a seller panel. But you're thinking like a pipeline when you should be thinking like a marketplace. What if every generated wizytówka is actually an **activated distribution node**?

Here's the adjacency hiding in plain sight: **you already own the supply side** (the businesses, their pages, their contact data). The demand side — sellers, agencies, SaaS tools wanting local Polish SMB reach — will pay to access that. Not per-lead. Per-seat, per-cohort, per-vertical. That's recurring revenue with near-zero marginal cost.

The 10x scenario: a business owner claims their wizytówka (you already have TG_CLIENT_BOT_TOKEN for this), upgrades it, starts getting analytics. Now you have **an inbound SMB SaaS product** layered on top of the scraper. The seller panel becomes a B2B marketplace. The wizytówka becomes a **free forever freemium hook** — claimed sites unlock Google indexing value for the business, and you upsell SEO dashboards, review aggregation, booking widgets.

Network effect you're ignoring: every claimed business enriches your dataset, which makes discovery smarter, which surfaces better leads, which closes more sellers. That's a flywheel, not a pipeline.

The single highest-leverage next step: **build the claim flow**. One business claims a site → data improves → seller lead quality improves → seller pays → business upgrades. Everything compounds from that one activation moment.

### The Outsider

"No visible monetization model."

That's the thing I keep getting stuck on. You've built something genuinely impressive — 95,000 localities, 4 automated pipelines, 3 Telegram bots, 24 layout combinations — and I have no idea how money changes hands.

Walk me through this like I've never heard of B2B software: who pays, what do they pay for, and what happens if they stop paying?

From where I sit, there are two possible customers here, and they're completely different people with completely different problems:

**The business owner** whose "wizytówka" got auto-generated. Did they ask for this? Do they know it exists? Why would they pay to edit something they didn't request?

**The "seller"** who triages leads. Who is this person? Are they your employee, a freelancer, an agency? What are they selling — the site itself? Upgrades? Ads?

The system seems to assume sellers exist and are motivated, but I don't see where they come from or what their incentive structure is.

Before scaling to more localities or adding analytics, I'd want to answer one thing: **has any money changed hands yet?** Even once?

If not, the next step isn't a technical feature at all. It's a single manual sale — find one business owner, show them the generated site, ask them to pay something, and watch what happens. Everything you learn from that conversation is worth more than another 10 design docs.

### The Executor

Forget scaling. You have 95k localities and a working pipeline. The bottleneck isn't data — it's revenue.

First thing you ship: a payment wall on the seller panel.

**Week 1:** Add a `subscription_status` column to `sellers`. Gate `/s/{token}` behind a Stripe Checkout redirect if status is `inactive`. Every seller hitting the panel either pays or bounces. You already have token auth — it's one middleware check.

**Week 2:** Integrate Stripe webhooks to flip `subscription_status`. That's your billing system. Done.

**Week 3:** Ship "Verified Badge" upsell to business owners via the client Telegram bot. They're already in your funnel via draft approval. Charge PLN 49/mo for a verified checkmark + priority placement in seller search results.

What you do NOT build next:
- Analytics dashboards (no one's paying yet, so no one cares)
- More categories (you're not capacity-constrained)
- CRM features (premature — you don't know what sellers actually need)

First concrete action: open `src/lib/leads.ts`, add `subscription_active` boolean to the seller schema, and put a Stripe redirect in the panel entry route. Ship that this week.

---

## Peer Review

**Anonimizacja:** A=Expansionist, B=Outsider, C=First Principles, D=Executor, E=Contrarian

### Reviewer 1

**Strongest: C (First Principles)** — identifies outcome data as the missing primitive. The `call_log` table exists but captures activity, not results. Without closing the feedback loop, every other direction is speculation. C reframes the question correctly.

**Biggest blind spot: A (Expansionist)** — "claim flow" vision is compelling but assumes business owners will want to claim unsolicited generated sites. Zero evidence for this. Also ignores the GDPR issue E raises.

**All missed:** Who are the sellers, how many are active, and what are they actually doing with leads? Usage data from `cron_log`, `call_log`, and seller activity is sitting in D1 right now and would answer half these questions.

### Reviewer 2

**Strongest: C (First Principles)** — right diagnostic before prescription.

**Biggest blind spot: D (Executor)** — Stripe integration on an unused panel produces zero revenue and wastes a week. Also ignores that business owners received sites without consent.

**All missed:** How many businesses scraped, how many sites generated, how many sellers exist? The council gave strategic advice without knowing the system's actual output volume. The answer depends on whether the system has produced 50 businesses or 50,000.

### Reviewer 3

**Strongest: C (First Principles)** — bottleneck is epistemic, not architectural.

**Biggest blind spot: D (Executor)** — payment without retention data is theater, not validation.

**All missed:** Speed of coverage closure determines defensibility. A competitor with SerpAPI and a weekend can replicate the pipeline. The moat is the content corpus + indexed URLs + claim graph — none of which exist at scale yet.

### Reviewer 4

**Strongest: C (First Principles)** — frames right question before answering wrong one.

**Biggest blind spot: A (Expansionist)** — claim flow assumes owners see value rather than GDPR violation or reputation risk.

**All missed:** The risk isn't product-market fit uncertainty — it's founder motivation misalignment. If the real pull is building a Polish business data OS rather than selling leads, the monetization conversation is secondary.

### Reviewer 5

**Strongest: C (First Principles)** — precise diagnosis.

**Biggest blind spot: D (Executor)** — billing infrastructure ≠ product-market fit validation. Sellers paying a subscription fee proves willingness to pay for access, not that leads have economic value.

**All missed:** The TERYT dataset has standalone B2B data product value entirely separate from the seller/owner funnel. Municipalities, telcos, mapping companies, market research firms would pay for clean access to this.

---

## Werdykt Rady

### Gdzie Rada się zgadza

Pięciu na pięciu doradców i pięciu na pięciu recenzentów wskazuje to samo: **nie ma dowodu, że ktokolwiek zapłaci.** To nie jest problem techniczny — to problem epistemiczny. Pipeline działa, architektura jest dojrzała, 20 design docs ukończonych — ale żaden z nich nie odpowiada na pytanie: "czy to generuje wartość, za którą ktoś wyciągnie portfel?"

Rada jednogłośnie odrzuca skalowanie pipeline'u jako następny krok.

### Gdzie Rada się nie zgadza

Spór dotyczy **jak** zwalidować wartość:

- **Executor:** wstaw Stripe, gate'uj panel, zmierz. Problem: billing na pustym panelu to infrastruktura bez klienta.
- **Expansionist:** zbuduj claim flow, freemium. Problem: zakłada chęć właścicieli do claimowania, GDPR komplikuje.
- **Outsider:** zrób jedną ręczną sprzedaż. **First Principles:** zamknij feedback loop w danych.

To nie jest prawdziwy konflikt — to dwie strony tej samej monety: walidacja jakościowa (rozmowa) i walidacja ilościowa (dane o konwersji).

### Ślepe punkty wykryte przez peer review

1. **Brak danych o aktualnym użyciu.** Ile sellerów aktywnych? Ile biznesów? Ile stron? Ile połączeń? Dane w D1 — Rada radziła na ślepo.
2. **GDPR jest realnym ryzykiem.** Generowanie stron bez wiedzy firm + sprzedaż ich danych to contested territory pod Art. 6.
3. **Dataset TERYT ma wartość standalone.** 95k lokalizacji z geokodowaniem — produkt danych sam w sobie.
4. **Motywacja foundera nieznana.** Data OS, SaaS dla SMB, czy narzędzie sprzedażowe?

### Rekomendacja

**Zamknij feedback loop, zanim zbudujesz cokolwiek nowego.**

Dodaj zbieranie danych o wynikach (outcome) do `call_log`. Równolegle: 5 ręcznych rozmów discovery z potencjalnymi klientami. Dopiero wyniki powiedzą, czy budować billing, claim flow, czy pivotować.

### Jeden pierwszy krok

Dodaj kolumnę `outcome TEXT` do `call_log` z enumem (`no_answer`, `not_interested`, `interested`, `meeting_set`, `deal_closed`) i endpoint + UI w seller panelu do jej aktualizacji. Jedna migracja D1, jeden endpoint, jeden przycisk. Za miesiąc — dane, które odpowiedzą na pytanie, czy reszta ma sens.
