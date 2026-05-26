import { completeRun, failRun, type RunResult, startRun } from "./cron-log";
import { dispatchCriticalAlert } from "./telegram";

export const CRON_PATTERNS = {
	geocoder: "0 * * * *",
	preflight: "55 7 * * *",
	discovery: "0 8 * * *",
	generate: "*/5 * * * *",
	chatTimeout: "*/10 * * * *",
	funnel: "0 9 * * 1",
} as const satisfies Record<string, string>;

export type CronName = keyof typeof CRON_PATTERNS;

export function isCronName(value: string): value is CronName {
	return value in CRON_PATTERNS;
}

async function executeCron(env: Env, cron: string): Promise<RunResult> {
	switch (cron) {
		case CRON_PATTERNS.geocoder: {
			const { geocodeLocalities } = await import("./geocoder");
			return geocodeLocalities(env);
		}
		case CRON_PATTERNS.preflight: {
			const { runPreflight } = await import("./discovery/preflight");
			return runPreflight(env);
		}
		case CRON_PATTERNS.discovery: {
			const { discoverBusinesses } = await import("./discovery");
			const stats = await discoverBusinesses(env);
			return {
				processed: stats.totalNewLeads,
				failed: 0,
				meta: {
					apiCalls: stats.totalApiCalls,
					businesses: stats.totalBusinesses,
					quotaExhausted: stats.quotaExhausted,
					errorKind: stats.errorKind ?? null,
					searchesLeft: stats.searchesLeft ?? null,
				},
			};
		}
		case CRON_PATTERNS.generate: {
			const { generateSites } = await import("./generate-sites");
			return generateSites(env);
		}
		case CRON_PATTERNS.chatTimeout: {
			const { endInactiveChatSessions, sendChatEndNotification } = await import(
				"./chat"
			);
			const result = await endInactiveChatSessions(env.leadgen);
			for (const sessionId of result.sessionIds) {
				await sendChatEndNotification(env, sessionId);
			}
			return { processed: result.ended, failed: 0 };
		}
		case CRON_PATTERNS.funnel: {
			const { runFunnelReport } = await import("./funnel");
			return runFunnelReport(env);
		}
		default:
			return { processed: 0, failed: 0 };
	}
}

export async function runScheduledCron(
	env: Env,
	cron: string,
	ctx: ExecutionContext,
): Promise<RunResult | { error: string }> {
	const runId = await startRun(env.leadgen, cron);
	try {
		const result = await executeCron(env, cron);
		await completeRun(env.leadgen, runId, result);
		if (cron === CRON_PATTERNS.discovery) {
			dispatchCriticalAlert(env, ctx, result);
		}
		return result;
	} catch (err) {
		await failRun(env.leadgen, runId, err);
		console.error(`[scheduled] ${cron} error:`, err);
		return { error: err instanceof Error ? err.message : String(err) };
	}
}
