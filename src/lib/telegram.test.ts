import { env } from 'cloudflare:workers';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatCronSection,
  formatDailyReport,
  sendCriticalAlert,
  dispatchCriticalAlert,
} from './telegram';
import type { CronSummaryRow, RunResult } from './cron-log';
import type { DailyReportStats } from './telegram';
import { resetDb } from '../../test/seed';

const CRON_LABELS: Record<string, string> = {
  '0 * * * *': 'Geocoder',
  '0 8 * * *': 'Discovery',
  '*/5 * * * *': 'Generator',
};

function baseStats(overrides: Partial<DailyReportStats> = {}): DailyReportStats {
  return {
    locality_name: 'Kraków',
    total_businesses: 0,
    new_leads: 0,
    top_leads: [],
    cronSection: '\n<b>Stan cron (24h):</b>\n\u2705 <b>Discovery</b>: 1 uruchomien',
    ...overrides,
  };
}

const SELLER = { token: 'tok_test' };
const DATE = '2026-04-07';

describe('formatCronSection', () => {
  it('returns empty string when no stats', () => {
    expect(formatCronSection([], CRON_LABELS)).toBe('');
  });

  it('formats a healthy run as checkmark line', () => {
    const stats: CronSummaryRow[] = [
      { cron_pattern: '0 * * * *', total_runs: 24, completed: 24, failed: 0, total_processed: 500, total_failed_items: 3 },
    ];

    const result = formatCronSection(stats, CRON_LABELS);

    expect(result).toContain('\u2705'); // ✅
    expect(result).toContain('Geocoder');
    expect(result).toContain('24 uruchomien');
    expect(result).toContain('500 przetworzonych');
  });

  it('formats a failed run with warning icon', () => {
    const stats: CronSummaryRow[] = [
      { cron_pattern: '0 8 * * *', total_runs: 1, completed: 0, failed: 1, total_processed: 0, total_failed_items: 0 },
    ];

    const result = formatCronSection(stats, CRON_LABELS);

    expect(result).toContain('\u274C'); // ❌
    expect(result).toContain('Discovery');
    expect(result).toContain('1 blad');
  });

  it('uses cron pattern as fallback label', () => {
    const stats: CronSummaryRow[] = [
      { cron_pattern: '0 12 * * *', total_runs: 1, completed: 1, failed: 0, total_processed: 5, total_failed_items: 0 },
    ];

    const result = formatCronSection(stats, CRON_LABELS);

    expect(result).toContain('0 12 * * *');
  });

  it('includes header', () => {
    const stats: CronSummaryRow[] = [
      { cron_pattern: '0 * * * *', total_runs: 1, completed: 1, failed: 0, total_processed: 10, total_failed_items: 0 },
    ];

    const result = formatCronSection(stats, CRON_LABELS);

    expect(result).toContain('Stan cron');
  });
});

describe('formatDailyReport', () => {
  it('renders quota-exhausted banner when flag set', () => {
    const result = formatDailyReport(SELLER, baseStats({ quotaExhausted: true }), DATE);

    expect(result).toContain('SerpAPI quota wyczerpane');
  });

  it('omits banner when quota flag is false', () => {
    const result = formatDailyReport(SELLER, baseStats({ quotaExhausted: false }), DATE);

    expect(result).not.toContain('SerpAPI quota wyczerpane');
  });

  it('renders banner before cron section', () => {
    const result = formatDailyReport(SELLER, baseStats({ quotaExhausted: true }), DATE);

    const bannerIdx = result.indexOf('SerpAPI quota wyczerpane');
    const cronIdx = result.indexOf('Stan cron');

    expect(bannerIdx).toBeGreaterThanOrEqual(0);
    expect(cronIdx).toBeGreaterThanOrEqual(0);
    expect(bannerIdx).toBeLessThan(cronIdx);
  });

  it('renders auth error banner when errorKind is "auth"', () => {
    const result = formatDailyReport(SELLER, baseStats({ errorKind: 'auth' }), DATE);

    expect(result).toContain('SerpAPI: klucz nieważny');
  });

  it('renders payment error banner when errorKind is "payment"', () => {
    const result = formatDailyReport(SELLER, baseStats({ errorKind: 'payment' }), DATE);

    expect(result).toContain('SerpAPI: brak płatności');
  });

  it('renders quota banner when errorKind is "quota" (no quotaExhausted flag)', () => {
    const result = formatDailyReport(SELLER, baseStats({ errorKind: 'quota' }), DATE);

    expect(result).toContain('SerpAPI quota wyczerpane');
  });

  it('omits banner when errorKind is "server" (transient)', () => {
    const result = formatDailyReport(SELLER, baseStats({ errorKind: 'server' }), DATE);

    expect(result).not.toContain('SerpAPI');
  });
});

// -- sendCriticalAlert --

function mockTelegramFetch() {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 1, chat: { id: 1, type: 'private' }, date: 0 },
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  );
}

describe('sendCriticalAlert', () => {
  beforeEach(async () => {
    await resetDb(env.leadgen);
  });

  it('sends to all sellers with notify_chat_id (skipping NULL)', async () => {
    // Reset seller anna's notify_chat_id to NULL — only Jan should receive
    await env.leadgen
      .prepare("UPDATE sellers SET notify_chat_id = NULL WHERE id = 2")
      .run();

    const fetchMock = mockTelegramFetch();
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const result = await sendCriticalAlert(env, { kind: 'quota', message: 'test alert body' });

      expect(result.sent).toBe(true);
      expect(result.recipients).toBe(1);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain(`/bot${env.TG_NOTIFY_BOT_TOKEN}/sendMessage`);
      const body = JSON.parse(init.body as string);
      expect(body.chat_id).toBe('100001');
      expect(body.text).toBe('test alert body');

      // alert_log row created
      const row = await env.leadgen
        .prepare("SELECT kind FROM alert_log WHERE kind = 'quota'")
        .first<{ kind: string }>();
      expect(row).not.toBeNull();
      expect(row!.kind).toBe('quota');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('debounces second call within 6h for same kind', async () => {
    // Insert recent alert_log row (1 hour ago) for kind=quota
    await env.leadgen
      .prepare("INSERT INTO alert_log (kind, sent_at) VALUES ('quota', datetime('now', '-1 hour'))")
      .run();

    const fetchMock = mockTelegramFetch();
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const result = await sendCriticalAlert(env, { kind: 'quota', message: 'should be debounced' });

      expect(result.sent).toBe(false);
      expect(result.recipients).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();

      // no new alert_log row inserted
      const { results } = await env.leadgen
        .prepare("SELECT id FROM alert_log WHERE kind = 'quota'")
        .all<{ id: number }>();
      expect(results).toHaveLength(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('sends again after debounce window has elapsed', async () => {
    // Stale alert_log row (7h ago) — outside the 6h window
    await env.leadgen
      .prepare("INSERT INTO alert_log (kind, sent_at) VALUES ('quota', datetime('now', '-7 hours'))")
      .run();

    const fetchMock = mockTelegramFetch();
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const result = await sendCriticalAlert(env, { kind: 'quota', message: 'fresh alert' });

      expect(result.sent).toBe(true);
      expect(result.recipients).toBeGreaterThan(0);
      expect(fetchMock).toHaveBeenCalled();

      // a new alert_log row was inserted (so we now have 2 rows for quota)
      const { results } = await env.leadgen
        .prepare("SELECT id FROM alert_log WHERE kind = 'quota'")
        .all<{ id: number }>();
      expect(results).toHaveLength(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('debounce is per-kind: different kind sends even if another kind is fresh', async () => {
    // Fresh quota alert exists — but we're sending an auth alert
    await env.leadgen
      .prepare("INSERT INTO alert_log (kind, sent_at) VALUES ('quota', datetime('now'))")
      .run();

    const fetchMock = mockTelegramFetch();
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const result = await sendCriticalAlert(env, { kind: 'auth', message: 'auth alert' });

      expect(result.sent).toBe(true);
      expect(result.recipients).toBeGreaterThan(0);

      const authRow = await env.leadgen
        .prepare("SELECT kind FROM alert_log WHERE kind = 'auth'")
        .first<{ kind: string }>();
      expect(authRow).not.toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('one failed recipient does not block the others', async () => {
    // Both seed sellers have notify_chat_id (100001, 100002).
    // First fetch call throws, second should still go through.
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error('network down');
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: 1, type: 'private' }, date: 0 } }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const result = await sendCriticalAlert(env, { kind: 'quota', message: 'partial outage' });

      // function did not throw — both attempted, one delivered
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.sent).toBe(true);
      expect(result.recipients).toBe(1);

      // alert_log row still inserted (alert was attempted, debounce should hold)
      const row = await env.leadgen
        .prepare("SELECT kind FROM alert_log WHERE kind = 'quota'")
        .first<{ kind: string }>();
      expect(row).not.toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// -- dispatchCriticalAlert --

function fakeCtx() {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil(p: Promise<unknown>) {
        promises.push(p);
      },
      passThroughOnException() {},
    } as unknown as ExecutionContext,
    settled: () => Promise.allSettled(promises),
  };
}

describe('dispatchCriticalAlert', () => {
  beforeEach(async () => {
    await resetDb(env.leadgen);
  });

  it('quotaExhausted=true triggers a quota alert via waitUntil', async () => {
    const fetchMock = mockTelegramFetch();
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const { ctx, settled } = fakeCtx();
      const result: RunResult = {
        processed: 0,
        failed: 0,
        meta: { quotaExhausted: true },
      };

      dispatchCriticalAlert(env, ctx, result);
      await settled();

      // alert_log row created
      const row = await env.leadgen
        .prepare("SELECT kind FROM alert_log WHERE kind = 'quota'")
        .first<{ kind: string }>();
      expect(row).not.toBeNull();

      // fetch was actually fired
      expect(fetchMock).toHaveBeenCalled();
      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
      const sent = calls.find((c) =>
        typeof c[0] === 'string' && c[0].includes('/sendMessage')
      );
      expect(sent).toBeTruthy();
      const body = JSON.parse(sent![1].body as string);
      expect(body.text).toContain('SerpAPI: quota');
      expect(body.text).toContain('https://wizytowka.link/s/REDACTED_TOKEN');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it.each(['auth', 'payment'] as const)(
    'errorKind=%s triggers an alert with that kind',
    async (kind) => {
      const fetchMock = mockTelegramFetch();
      const origFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        const { ctx, settled } = fakeCtx();
        const result: RunResult = {
          processed: 0,
          failed: 0,
          meta: { errorKind: kind, quotaExhausted: false },
        };

        dispatchCriticalAlert(env, ctx, result);
        await settled();

        const row = await env.leadgen
          .prepare("SELECT kind FROM alert_log WHERE kind = ?")
          .bind(kind)
          .first<{ kind: string }>();
        expect(row).not.toBeNull();
        expect(row!.kind).toBe(kind);

        const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
        const sent = calls.find((c) =>
          typeof c[0] === 'string' && c[0].includes('/sendMessage')
        );
        expect(sent).toBeTruthy();
        const body = JSON.parse(sent![1].body as string);
        expect(body.text).toContain(`SerpAPI: ${kind}`);
      } finally {
        globalThis.fetch = origFetch;
      }
    }
  );

  it('successful run with no critical meta does not fire alert', async () => {
    const fetchMock = mockTelegramFetch();
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const { ctx, settled } = fakeCtx();
      const result: RunResult = {
        processed: 12,
        failed: 0,
        meta: { quotaExhausted: false, errorKind: null, apiCalls: 5, businesses: 12 },
      };

      dispatchCriticalAlert(env, ctx, result);
      await settled();

      expect(fetchMock).not.toHaveBeenCalled();
      const { results } = await env.leadgen
        .prepare("SELECT id FROM alert_log")
        .all<{ id: number }>();
      expect(results).toHaveLength(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('does not fire when meta is undefined', async () => {
    const fetchMock = mockTelegramFetch();
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const { ctx, settled } = fakeCtx();
      const result: RunResult = { processed: 0, failed: 0 };

      dispatchCriticalAlert(env, ctx, result);
      await settled();

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('does not fire when errorKind is "server" (transient)', async () => {
    const fetchMock = mockTelegramFetch();
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const { ctx, settled } = fakeCtx();
      const result: RunResult = {
        processed: 0,
        failed: 0,
        meta: { errorKind: 'server', quotaExhausted: false },
      };

      dispatchCriticalAlert(env, ctx, result);
      await settled();

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('alert failure does not propagate (synchronous return + waitUntil swallows)', async () => {
    // Every fetch throws — sendCriticalAlert catches per-recipient, but to also
    // exercise the .catch() wrapper we kill the DB query path by dropping alert_log.
    await env.leadgen.prepare('DROP TABLE alert_log').run();

    const fetchMock = vi.fn(async () => { throw new Error('boom'); });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const { ctx, settled } = fakeCtx();
      const result: RunResult = {
        processed: 0,
        failed: 0,
        meta: { quotaExhausted: true },
      };

      // Synchronous call must not throw
      expect(() => dispatchCriticalAlert(env, ctx, result)).not.toThrow();

      // Awaiting the queued promise via Promise.allSettled must also resolve
      const settledResults = await settled();
      expect(settledResults.every(r => r.status === 'fulfilled')).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
      // Recreate alert_log so subsequent tests in the same file are unaffected
      // (each test has its own resetDb in beforeEach, but be defensive).
      await env.leadgen.prepare(`
        CREATE TABLE IF NOT EXISTS alert_log (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          kind    TEXT NOT NULL,
          sent_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run();
    }
  });
});
