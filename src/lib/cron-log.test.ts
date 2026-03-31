import { env } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../test/seed';
import { startRun, completeRun, failRun, type RunResult } from './cron-log';

interface CronLogRow {
  id: number;
  cron_pattern: string;
  started_at: string;
  finished_at: string | null;
  items_processed: number;
  items_failed: number;
  status: string;
  error: string | null;
  meta: string | null;
}

beforeEach(() => resetDb(env.leadgen));

describe('cron-log', () => {
  it('startRun inserts a running row and returns its id', async () => {
    const id = await startRun(env.leadgen, '0 * * * *');

    const row = await env.leadgen
      .prepare('SELECT * FROM cron_log WHERE id = ?')
      .bind(id)
      .first<CronLogRow>();

    expect(row).toBeTruthy();
    expect(row!.cron_pattern).toBe('0 * * * *');
    expect(row!.status).toBe('running');
    expect(row!.finished_at).toBeNull();
    expect(row!.items_processed).toBe(0);
    expect(row!.items_failed).toBe(0);
  });

  it('completeRun sets status=completed with counts and finished_at', async () => {
    const id = await startRun(env.leadgen, '0 8 * * *');
    const result: RunResult = { processed: 10, failed: 2 };

    await completeRun(env.leadgen, id, result);

    const row = await env.leadgen
      .prepare('SELECT * FROM cron_log WHERE id = ?')
      .bind(id)
      .first<CronLogRow>();

    expect(row!.status).toBe('completed');
    expect(row!.items_processed).toBe(10);
    expect(row!.items_failed).toBe(2);
    expect(row!.finished_at).toBeTruthy();
    expect(row!.error).toBeNull();
  });

  it('failRun sets status=failed with error message', async () => {
    const id = await startRun(env.leadgen, '*/5 * * * *');

    await failRun(env.leadgen, id, new Error('something broke'));

    const row = await env.leadgen
      .prepare('SELECT * FROM cron_log WHERE id = ?')
      .bind(id)
      .first<CronLogRow>();

    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('something broke');
    expect(row!.finished_at).toBeTruthy();
  });

  it('completeRun stores meta as JSON', async () => {
    const id = await startRun(env.leadgen, '0 8 * * *');
    const result: RunResult = {
      processed: 5,
      failed: 0,
      meta: { apiCalls: 12, quotaExhausted: false },
    };

    await completeRun(env.leadgen, id, result);

    const row = await env.leadgen
      .prepare('SELECT meta FROM cron_log WHERE id = ?')
      .bind(id)
      .first<{ meta: string }>();

    expect(JSON.parse(row!.meta)).toEqual({ apiCalls: 12, quotaExhausted: false });
  });
});
