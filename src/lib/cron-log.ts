export interface RunResult {
	processed: number;
	failed: number;
	meta?: Record<string, unknown>;
}

export async function startRun(
	db: D1Database,
	cronPattern: string,
): Promise<number> {
	const meta = await db
		.prepare("INSERT INTO cron_log (cron_pattern) VALUES (?) RETURNING id")
		.bind(cronPattern)
		.first<{ id: number }>();
	if (!meta) throw new Error("Failed to create cron_log row");
	return meta.id;
}

export async function completeRun(
	db: D1Database,
	runId: number,
	result: RunResult,
): Promise<void> {
	await db
		.prepare(
			`UPDATE cron_log
       SET status = 'completed',
           items_processed = ?,
           items_failed = ?,
           finished_at = datetime('now'),
           meta = ?
       WHERE id = ?`,
		)
		.bind(
			result.processed,
			result.failed,
			result.meta ? JSON.stringify(result.meta) : null,
			runId,
		)
		.run();
}

export interface CronSummaryRow {
	cron_pattern: string;
	total_runs: number;
	completed: number;
	failed: number;
	total_processed: number;
	total_failed_items: number;
}

export async function getCronSummary(
	db: D1Database,
): Promise<CronSummaryRow[]> {
	const { results } = await db
		.prepare(
			`SELECT
         cron_pattern,
         COUNT(*) as total_runs,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
         SUM(items_processed) as total_processed,
         SUM(items_failed) as total_failed_items
       FROM cron_log
       WHERE started_at >= datetime('now', '-1 day')
       GROUP BY cron_pattern
       ORDER BY cron_pattern`,
		)
		.all<CronSummaryRow>();
	return results;
}

export async function failRun(
	db: D1Database,
	runId: number,
	err: unknown,
): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	await db
		.prepare(
			`UPDATE cron_log
       SET status = 'failed',
           error = ?,
           finished_at = datetime('now')
       WHERE id = ?`,
		)
		.bind(message, runId)
		.run();
}
