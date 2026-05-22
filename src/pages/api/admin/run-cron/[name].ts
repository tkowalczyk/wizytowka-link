import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { timingSafeCompare } from "../../../../lib/auth";
import {
	CRON_PATTERNS,
	type CronName,
	isCronName,
	runScheduledCron,
} from "../../../../lib/scheduled";

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const POST: APIRoute = async ({ params, request, locals }) => {
	const env = runtimeEnv;
	const ctx = locals.cfContext;

	const expected = env.ADMIN_TOKEN;
	if (!expected) {
		return json({ error: "ADMIN_TOKEN not configured" }, 500);
	}
	const provided = request.headers.get("x-admin-token");
	if (!(await timingSafeCompare(provided, expected))) {
		return json({ error: "unauthorized" }, 401);
	}

	const name = params.name;
	if (!name || !isCronName(name)) {
		return json(
			{
				error: "unknown cron",
				available: Object.keys(CRON_PATTERNS) as CronName[],
			},
			400,
		);
	}

	const cron = CRON_PATTERNS[name];
	const result = await runScheduledCron(env, cron, ctx);
	const failed = "error" in result;
	return json({ name, cron, result }, failed ? 500 : 200);
};
