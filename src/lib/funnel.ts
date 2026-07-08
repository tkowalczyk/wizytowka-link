import type { CallLogRow, SellerRow } from "../types/business";
import type { RunResult } from "./cron-log";
import { escapeHtml, sendMessage } from "./telegram";

type Status = CallLogRow["status"];

const ALL_STATUSES: Status[] = [
	"pending",
	"called",
	"interested",
	"rejected",
	"no_answer",
	"meeting_set",
	"deal_closed",
];

export interface FunnelStats {
	total: number;
	counts: Record<Status, number>;
}

export async function getFunnelStats(
	db: D1Database,
	sellerId: number,
): Promise<FunnelStats> {
	const { results } = await db
		.prepare(
			`SELECT status, COUNT(*) as cnt
       FROM (
         SELECT status,
           ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC, id DESC) as rn
         FROM call_log WHERE seller_id = ?
       ) WHERE rn = 1
       GROUP BY status`,
		)
		.bind(sellerId)
		.all<{ status: Status; cnt: number }>();

	const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<
		Status,
		number
	>;

	let total = 0;
	for (const row of results) {
		counts[row.status] = row.cnt;
		total += row.cnt;
	}

	return { total, counts };
}

function zeroCounts(): Record<Status, number> {
	return Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<
		Status,
		number
	>;
}

async function getWeekCounts(
	db: D1Database,
	sellerId: number,
	fromDays: number,
	toDays: number,
): Promise<Record<Status, number>> {
	const { results } = await db
		.prepare(
			`SELECT status, COUNT(*) as cnt
       FROM (
         SELECT status,
           ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC, id DESC) as rn
         FROM call_log
         WHERE seller_id = ?
           AND created_at >= datetime('now', ? || ' days')
           AND created_at < datetime('now', ? || ' days')
       ) WHERE rn = 1
       GROUP BY status`,
		)
		.bind(sellerId, -fromDays, -toDays)
		.all<{ status: Status; cnt: number }>();

	const counts = zeroCounts();
	for (const row of results) {
		counts[row.status] = row.cnt;
	}
	return counts;
}

export async function getWeekOverWeekDelta(
	db: D1Database,
	sellerId: number,
): Promise<Record<Status, number>> {
	const current = await getWeekCounts(db, sellerId, 7, 0);
	const previous = await getWeekCounts(db, sellerId, 14, 7);

	const delta = zeroCounts();
	for (const s of ALL_STATUSES) {
		delta[s] = current[s] - previous[s];
	}
	return delta;
}

const STATUS_LABELS: Record<Status, string> = {
	pending: "Oczekujące",
	called: "Dzwoniono",
	interested: "Zainteresowani",
	rejected: "Odrzuceni",
	no_answer: "Brak odpowiedzi",
	meeting_set: "Umówione spotkania",
	deal_closed: "Zamknięte deale",
};

function formatDelta(d: number): string {
	if (d === 0) return "";
	return d > 0 ? ` (+${d})` : ` (${d})`;
}

export function formatFunnelReport(
	stats: FunnelStats,
	delta: Record<Status, number>,
	sellerToken: string,
	date: string,
): string {
	const lines: string[] = [
		`<b>Raport tygodniowy — ${escapeHtml(date)}</b>`,
		"",
		`Leadów łącznie: <b>${stats.total}</b>`,
		"",
	];

	for (const s of ALL_STATUSES) {
		const label = STATUS_LABELS[s];
		const count = stats.counts[s];
		const d = formatDelta(delta[s]);
		lines.push(`${label}: ${count}${d}`);
	}

	lines.push(
		"",
		`<a href="https://wizytowka.link/s/${sellerToken}">Otwórz panel →</a>`,
	);

	return lines.join("\n");
}

export async function runFunnelReport(env: Env): Promise<RunResult> {
	const { results: sellers } = await env.leadgen
		.prepare("SELECT * FROM sellers WHERE report_chat_id IS NOT NULL")
		.all<SellerRow>();

	const date = new Date().toISOString().slice(0, 10);
	let processed = 0;
	let failed = 0;

	for (const seller of sellers) {
		const stats = await getFunnelStats(env.leadgen, seller.id);
		const delta = await getWeekOverWeekDelta(env.leadgen, seller.id);
		const text = formatFunnelReport(stats, delta, seller.token, date);

		try {
			await sendMessage(
				env.TG_SELLER_BOT_TOKEN,
				seller.report_chat_id as string,
				text,
			);
			processed++;
		} catch (err) {
			console.error(`[funnel] failed to send to seller ${seller.id}:`, err);
			failed++;
		}
	}

	return { processed, failed, meta: { sellers: sellers.length } };
}
