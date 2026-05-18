import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { Leads } from "../../lib/leads";

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const GET: APIRoute = async ({ request }) => {
	const db: D1Database = env.leadgen;
	const leads = new Leads(db);

	const token = Leads.extractToken(request);
	if (!token) return json({ error: "brak tokenu" }, 401);

	const seller = await leads.authenticate(token);
	if (!seller) return json({ error: "nieprawidlowy token" }, 401);

	const url = new URL(request.url);
	const pattern = url.searchParams.get("pattern");
	const limit = Math.min(
		parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
		200,
	);

	let query: string;
	const binds: unknown[] = [];

	if (pattern) {
		query =
			"SELECT * FROM cron_log WHERE cron_pattern = ? ORDER BY id DESC LIMIT ?";
		binds.push(pattern, limit);
	} else {
		query = "SELECT * FROM cron_log ORDER BY id DESC LIMIT ?";
		binds.push(limit);
	}

	const { results } = await db
		.prepare(query)
		.bind(...binds)
		.all();
	return json({ runs: results });
};
