import type { APIRoute } from "astro";
import { Leads } from "../../lib/leads";
import { normalizePhone } from "../../lib/phone";
import { siteKey } from "../../lib/site-store";
import { sendMessage } from "../../lib/telegram";
import type { SellerRow } from "../../types/business";

interface ContactBody {
	phone: string;
	token: string;
}

interface TurnstileResponse {
	success: boolean;
	"error-codes"?: string[];
}

function json(data: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const POST: APIRoute = async ({ request, locals }) => {
	const env = locals.runtime.env;

	let body: ContactBody;
	try {
		body = (await request.json()) as ContactBody;
	} catch {
		return json({ error: "nieprawidlowe dane" }, 400);
	}

	const phone = normalizePhone(body.phone ?? "");
	if (!phone) return json({ error: "nieprawidlowy numer telefonu" }, 400);

	// Turnstile verification
	const turnstileRes = await fetch(
		"https://challenges.cloudflare.com/turnstile/v0/siteverify",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				secret: env.TURNSTILE_SECRET_KEY,
				response: body.token,
			}),
		},
	);
	const turnstile = (await turnstileRes.json()) as TurnstileResponse;
	if (!turnstile.success) {
		return json({ error: "weryfikacja nieudana" }, 403);
	}

	const leads = new Leads(env.leadgen);
	const matches = await leads.matchByPhone(phone);

	let matchBlock: string;

	if (matches.length > 0) {
		const lines: string[] = [];
		lines.push(`Pasujace firmy: ${matches.length}`);

		for (let i = 0; i < matches.length; i++) {
			const m = matches[i];
			const ownerToken = await leads.ensureOwnerToken(m.id);

			// Check if site exists in R2
			const siteR2Key = siteKey("live", m.locality_slug, m.slug);
			const siteObj = await env.sites.head(siteR2Key);

			const deepLink = `t.me/wizytowka_klient_bot?start=${ownerToken}`;
			let line = `\n${i + 1}. ${m.title} — ${m.category} — ${m.locality_name}`;
			if (siteObj) {
				line += `\n   🌐 wizytowka.link/${m.locality_slug}/${m.slug}`;
			}
			line += `\n   🤖 ${deepLink}`;
			if (!siteObj) {
				line += `\n   (strona nie wygenerowana)`;
			}

			lines.push(line);
		}

		matchBlock = lines.join("\n");
	} else {
		matchBlock = "Brak firm z tym numerem w bazie";
	}

	// Query sellers with Telegram
	const sellers = await env.leadgen
		.prepare(
			"SELECT id, name, notify_chat_id, token FROM sellers WHERE notify_chat_id IS NOT NULL",
		)
		.all<SellerRow>();

	const msg = `📞 <b>Nowy kontakt z formularza</b>\n\nTelefon: ${phone}\n\n${matchBlock}`;

	for (const seller of sellers.results) {
		await sendMessage(env.TG_NOTIFY_BOT_TOKEN, seller.notify_chat_id!, msg);
	}

	return json({ ok: true });
};
