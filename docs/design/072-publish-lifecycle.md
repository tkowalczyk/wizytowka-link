# DD-072: Publish lifecycle — cache freshness after approval + unpublish gate

Closes issue #72. Two publish-lifecycle gaps, each needing a small product
decision before code. Decisions recorded here; test slices implemented in the
same change.

## Gap 1 — stale cache after owner approval / theme change

### Problem

Public business pages (`src/pages/[loc]/[slug].astro`) and their `.md` exports
(`src/pages/[loc]/[slug].md.ts`) were served with
`Cache-Control: public, max-age=86400, s-maxage=604800`. `promoteDraft`
(`src/lib/site-store.ts`, invoked from owner approval in
`src/lib/telegram/handlers/client.ts`) and `changeTheme`
(`src/lib/presentation.ts`) perform no purge.

Consequence: an owner taps "Zatwierdź" in Telegram, opens their page to verify,
and can see the old content for up to 24h (browser `max-age`). The
approve-then-verify loop — the emotional peak of the owner flow — was broken by
design.

### Decision — option (a): short browser `max-age`

`publicCacheControl()` (`src/lib/public-page.ts`) returns
`public, max-age=300, s-maxage=604800`, used by both the HTML and `.md` routes.

- **Why (a):** cheapest, zero new moving parts, no secrets. There is no edge
  cache today, so `s-maxage` is inert — the only live pain is the browser
  `max-age`, which 300s (5 min) reduces to a brief self-heal on the canonical
  URL. No purge call is added to `promoteDraft`/`changeTheme`.
- **Why not (b)** (cache-busted `?v=` URL in the approval reply): gives an
  instant view but leaves the canonical/shareable URL stale; more surface for
  little gain once (a) heals within minutes.
- **Why not (c)** (real Cloudflare purge API): most work, and only pays off once
  custom-domain edge caching exists. Deferred — this is the documented
  follow-up **for the day `s-maxage` starts to bite**, i.e. when edge caching is
  enabled.

### Test slice

`src/lib/public-page.test.ts` asserts `publicCacheControl()` has
`max-age` ≤ 300 and stays `public`. The `.md` route's served response is
asserted ≤ 300 in `src/pages/[loc]/[slug].md.test.ts`.

## Gap 2 — no unpublish path; pages stay live + indexable regardless of `site_status`

### Problem

- `src/pages/[loc]/[slug].astro` (business query + `isIndexable`) never checked
  `site_status`.
- `src/pages/[loc]/[slug].md.ts` served any live R2 object unconditionally.
- Every listing surface (locality index, category, sitemap, llms.txt) filters
  `site_status='done'`, and `deleteSite` is only called for drafts.

So a business ever flipped off `done` (owner removal request, GDPR erasure,
re-classification) silently stayed live + indexable while vanishing from every
list. No active flip exists in code today, but a removal flow needs the routes
to stop serving.

### Decision — 410 Gone for non-`done`

`isPubliclyServable(siteStatus)` (`src/lib/site-status.ts`) returns
`siteStatus === 'done'`, mirroring the `site_status='done'` filter every listing
surface already uses. Both public routes gate on it:

| Condition                                   | HTML route | `.md` route |
| ------------------------------------------- | ---------- | ----------- |
| Live R2 object missing                      | 404        | 404         |
| Live object present, `site_status != 'done'`| **410**    | **410**     |
| Live object present, `site_status = 'done'` | 200        | 200         |

- **Why 410 over 404:** the motivating scenarios (removal, GDPR, re-class) are
  *withdrawals* of previously-servable content; 410 Gone tells crawlers to
  deindex faster than a 404 they may retry.
- **Scope:** the gate is a belt-and-suspenders serving check keyed on
  `site_status` — it withholds even if a future purge/delete is missed. It does
  **not** itself flip any status or delete R2 objects; a removal flow (R2 delete
  + status flip) is separate work. The `?draft=1` preview path is intentionally
  left viewable via its token — the gate only guards the public, non-draft path.
- **HTML route serves inside Astro SSR**, which the worker test harness mocks
  (`@astrojs/cloudflare/handler` is stubbed), so the frontmatter can't be
  invoked directly in-suite. The gate decision is covered behaviorally by
  `isPubliclyServable` unit tests; the route's wiring is asserted against its
  `?raw` source; the `.md` sibling route is covered end-to-end.

### Test slice

- `src/lib/site-status.test.ts`: `isPubliclyServable` — `'done'` → true;
  `pending`/`in_progress`/`ineligible`/`null`/`undefined` → false.
- `src/pages/[loc]/[slug].md.test.ts`: seed a live object for an `ineligible`
  business → 410; a `done` business → 200 (short cache); missing object → 404.
  (410 and short-cache both failed before this change; both served 200 / 24h.)
- `src/pages/[loc]/[slug].astro.test.ts`: `?raw` wiring — biz `SELECT` includes
  `site_status`, gate calls `isPubliclyServable(biz.site_status)` and returns
  `status: 410`, and the header uses `publicCacheControl()`.
