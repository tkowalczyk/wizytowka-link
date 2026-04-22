import type { APIRoute } from "astro";
import { Leads } from "../../../lib/leads";
import type { CallLogRow } from "../../../types/business";

interface UpdateLeadBody {
	status?: CallLogRow["status"];
	comment?: string;
}

const VALID_STATUSES: readonly CallLogRow["status"][] = [
	"pending",
	"called",
	"interested",
	"rejected",
	"no_answer",
	"meeting_set",
	"deal_closed",
] as const;

function json(data: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
	const id = parseInt(params.id ?? "", 10);
	if (Number.isNaN(id)) return json({ error: "nieprawidlowe ID" }, 400);

	const leads = new Leads(locals.runtime.env.leadgen);
	const token = Leads.extractToken(request);
	if (!token) return json({ error: "brak tokenu" }, 401);

	const seller = await leads.authenticate(token);
	if (!seller) return json({ error: "nieprawidlowy token" }, 401);

	let body: UpdateLeadBody;
	try {
		body = await request.json();
	} catch {
		return json({ error: "nieprawidlowy JSON" }, 400);
	}

	if (body.status && !VALID_STATUSES.includes(body.status)) {
		return json({ error: "nieprawidlowy status", valid: VALID_STATUSES }, 400);
	}

	if (!body.status && body.comment !== undefined) {
		await leads.updateComment(id, seller.id, body.comment);
		return json({ ok: true });
	}

	if (!body.status) return json({ error: "status lub comment wymagany" }, 400);

	if (!(await leads.businessExists(id))) {
		return json({ error: "firma nie istnieje" }, 404);
	}

	await leads.logStatus(id, seller.id, body.status, body.comment);
	return json({ ok: true, status: body.status });
};
