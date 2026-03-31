export interface RunResult {
  processed: number;
  failed: number;
  meta?: Record<string, unknown>;
}

export async function startRun(db: D1Database, cronPattern: string): Promise<number> {
  const { meta } = await db
    .prepare('INSERT INTO cron_log (cron_pattern) VALUES (?) RETURNING id')
    .bind(cronPattern)
    .first<{ id: number }>()
    .then(row => ({ meta: row! }));
  return meta.id;
}

export async function completeRun(db: D1Database, runId: number, result: RunResult): Promise<void> {
  await db
    .prepare(
      `UPDATE cron_log
       SET status = 'completed',
           items_processed = ?,
           items_failed = ?,
           finished_at = datetime('now'),
           meta = ?
       WHERE id = ?`
    )
    .bind(result.processed, result.failed, result.meta ? JSON.stringify(result.meta) : null, runId)
    .run();
}

export async function failRun(db: D1Database, runId: number, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await db
    .prepare(
      `UPDATE cron_log
       SET status = 'failed',
           error = ?,
           finished_at = datetime('now')
       WHERE id = ?`
    )
    .bind(message, runId)
    .run();
}
