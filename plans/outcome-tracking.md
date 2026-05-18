# Plan: Outcome Tracking (rozszerzenie statusow call_log)

> Source PRD: https://github.com/tkowalczyk/wizytowka-link/issues/25

## Architectural decisions

- **Data model**: extend existing `status` CHECK constraint in `call_log` with 3 new values (`no_answer`, `meeting_set`, `deal_closed`). No new columns or tables. Append-only pattern preserved.
- **Migration strategy**: D1 table-swap (CREATE new → INSERT SELECT → DROP old → RENAME). Safe at current scale (<100 rows, panel unused).
- **Status flow**: no enforced ordering — seller picks any status freely.
- **Status labels**: English values in DB/API, Polish labels in UI only.
- **Funnel report**: weekly Telegram message via existing seller bot (`TG_SELLER_BOT_TOKEN`), new cron entry in `CRON_PATTERNS`.
- **Status palette**:
  | Value | Polish label | Color |
  |-------|-------------|-------|
  | `pending` | Nowy | gray |
  | `called` | Dzwoniono | blue |
  | `no_answer` | Brak odpowiedzi | amber |
  | `interested` | Zainteresowany | green |
  | `rejected` | Odmowa | red |
  | `meeting_set` | Spotkanie | purple |
  | `deal_closed` | Zamkniete | emerald |

---

## Phase 1: Migration + API + Tests

**User stories**: #1, #2, #3, #5, #9

### What to build

A D1 migration that swaps the `call_log` table to accept 7 status values instead of 4. Update the TypeScript union type for `CallLogRow["status"]` and the `VALID_STATUSES` array in the leads API endpoint. Existing rows keep their original status. Write tests verifying all 7 values are accepted by `logStatus()`, that invalid values are rejected by the API, and that `list()` filters correctly by new statuses.

End-to-end verification: `curl -X PUT /api/leads/{id}` with `{"status": "deal_closed"}` returns `200 {ok: true}`, and the row appears in D1 with the new status.

### Acceptance criteria

- [ ] Migration runs without error on local D1 (via `pnpm seed` or `wrangler d1 migrations apply`)
- [ ] All existing `call_log` rows preserved with original status values after migration
- [ ] `INSERT INTO call_log` with any of 7 statuses succeeds; invalid values rejected by CHECK
- [ ] Indexes `idx_call_log_business` and `idx_call_log_seller_biz` exist after swap
- [ ] `CallLogRow["status"]` TypeScript union includes all 7 values
- [ ] `tsc --noEmit` passes
- [ ] API `PUT /api/leads/{id}` accepts `no_answer`, `meeting_set`, `deal_closed`
- [ ] API returns 400 for status values outside the set of 7
- [ ] `leads.test.ts` covers `logStatus()` with all 3 new statuses
- [ ] `leads.test.ts` covers `list()` filtering by `no_answer`, `meeting_set`, `deal_closed`
- [ ] All existing tests pass without modification (backward compatibility)

---

## Phase 2: Seller Panel UI

**User stories**: #4, #5, #6, #8

### What to build

Update the seller panel dropdown to show 7 status options with Polish labels. Add distinct badge colors for new statuses (amber for `no_answer`, purple for `meeting_set`, emerald for `deal_closed`). Update the status filter buttons in the panel header to include the 3 new statuses. Ensure the client-side JS sends the correct English value to the API and updates the badge dynamically after a status change.

End-to-end verification: seller opens `/s/{token}`, sees dropdown with 7 Polish-labeled options, selects "Zamkniete", badge turns emerald, no page reload.

### Acceptance criteria

- [ ] Dropdown shows 7 options with Polish labels in correct order
- [ ] Each status has a visually distinct badge color
- [ ] Selecting a new status sends correct English value (`no_answer` / `meeting_set` / `deal_closed`) to API
- [ ] Badge color and text update dynamically after status change (no reload)
- [ ] Status filter buttons in panel header include new statuses
- [ ] Filtering by new statuses returns correct leads
- [ ] Hidden status-config JSON includes color/label data for all 7 statuses
- [ ] Panel renders correctly with mix of old and new statuses in lead list

---

## Phase 3: Telegram Funnel Report

**User stories**: #7, #8, #10

### What to build

A new weekly cron job (Monday 9:00, `0 9 * * 1`) that queries `call_log` for the latest status per business per seller, groups by status, and sends a formatted Telegram message to each seller's `report_chat_id`. The message includes: total leads, count per status, and week-over-week delta (compared to previous Monday's snapshot). Register the cron in `CRON_PATTERNS` and `wrangler.jsonc`.

End-to-end verification: manual trigger via `/api/admin/run-cron/funnel` sends a Telegram message with status breakdown to the seller.

### Acceptance criteria

- [ ] New cron pattern registered in `CRON_PATTERNS` and `wrangler.jsonc`
- [ ] Cron handler returns `RunResult` and is logged via `startRun`/`completeRun`/`failRun`
- [ ] Telegram message includes count per status (all 7) + total leads
- [ ] Message includes week-over-week delta (e.g. "+3 interested, +1 deal_closed")
- [ ] Message sent to seller's `report_chat_id`; skips sellers without `report_chat_id`
- [ ] Zero-lead sellers handled gracefully (skip or minimal message)
- [ ] Manual trigger via `/api/admin/run-cron/funnel` works
- [ ] Test covers funnel query correctness (counts per status match seed data)
