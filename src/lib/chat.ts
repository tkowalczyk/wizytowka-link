import { escapeHtml, sendMessage } from "./telegram";

export interface StartChatInput {
	locSlug: string;
	businessSlug: string;
	sessionId?: string | null;
}

export interface StartChatMeta {
	referrer: string | null;
	userAgent: string | null;
	startedAt?: string;
}

export interface StartChatResult {
	sessionId: string;
	status: "active";
}

interface BusinessPageRow {
	id: number;
	locality_slug: string;
	business_slug: string;
}

interface ChatNotificationSessionRow {
	id: string;
	locality_slug: string;
	business_slug: string;
	started_at: string;
	referrer: string | null;
	telegram_start_sent_at: string | null;
}

interface ChatNotificationEnv {
	leadgen: D1Database;
	TG_NOTIFY_BOT_TOKEN: string;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function parseStartChatInput(body: unknown): StartChatInput | null {
	if (typeof body !== "object" || body === null) return null;
	const data = body as Record<string, unknown>;
	if (!isNonEmptyString(data.locSlug) || !isNonEmptyString(data.businessSlug)) {
		return null;
	}
	return {
		locSlug: data.locSlug.trim(),
		businessSlug: data.businessSlug.trim(),
		sessionId: isNonEmptyString(data.sessionId) ? data.sessionId.trim() : null,
	};
}

async function findBusinessPage(
	db: D1Database,
	input: StartChatInput,
): Promise<BusinessPageRow | null> {
	return db
		.prepare(
			`SELECT b.id, l.slug AS locality_slug, b.slug AS business_slug
       FROM businesses b
       JOIN localities l ON b.locality_id = l.id
       WHERE l.slug = ? AND b.slug = ? AND b.site_status = 'done'`,
		)
		.bind(input.locSlug, input.businessSlug)
		.first<BusinessPageRow>();
}

async function findActiveSession(
	db: D1Database,
	input: StartChatInput,
): Promise<StartChatResult | null> {
	if (!input.sessionId) return null;
	const row = await db
		.prepare(
			`SELECT id, status FROM chat_sessions
       WHERE id = ? AND locality_slug = ? AND business_slug = ? AND status = 'active'`,
		)
		.bind(input.sessionId, input.locSlug, input.businessSlug)
		.first<{ id: string; status: "active" }>();
	if (!row) return null;
	return { sessionId: row.id, status: row.status };
}

async function recordChatStartEvent(
	db: D1Database,
	params: {
		input: StartChatInput;
		sessionId: string;
		occurredAt: string;
		referrer: string | null;
		userAgent: string | null;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT OR IGNORE INTO analytics_events (
         event_type, locality_slug, business_slug, session_id,
         occurred_at, referrer, user_agent
       ) VALUES ('chat_start', ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			params.input.locSlug,
			params.input.businessSlug,
			params.sessionId,
			params.occurredAt,
			params.referrer,
			params.userAgent,
		)
		.run();
}

export async function startChatSession(
	db: D1Database,
	input: StartChatInput,
	meta: StartChatMeta,
): Promise<StartChatResult | null> {
	const startedAt = meta.startedAt ?? new Date().toISOString();
	const existing = await findActiveSession(db, input);
	if (existing) {
		await recordChatStartEvent(db, {
			input,
			sessionId: existing.sessionId,
			occurredAt: startedAt,
			referrer: meta.referrer,
			userAgent: meta.userAgent,
		});
		return existing;
	}

	const business = await findBusinessPage(db, input);
	if (!business) return null;

	const sessionId = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO chat_sessions (
         id, business_id, locality_slug, business_slug, started_at,
         status, referrer, user_agent
       ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
		)
		.bind(
			sessionId,
			business.id,
			business.locality_slug,
			business.business_slug,
			startedAt,
			meta.referrer,
			meta.userAgent,
		)
		.run();

	await recordChatStartEvent(db, {
		input,
		sessionId,
		occurredAt: startedAt,
		referrer: meta.referrer,
		userAgent: meta.userAgent,
	});

	return { sessionId, status: "active" };
}

function formatChatStartedMessage(session: ChatNotificationSessionRow): string {
	const pageSlug = `${session.locality_slug}/${session.business_slug}`;
	return [
		"🤖 <b>Nowy chat rozpoczęty</b>",
		"",
		`Strona: ${escapeHtml(pageSlug)}`,
		`Rozpoczęto: ${escapeHtml(session.started_at)}`,
		`Referrer: ${escapeHtml(session.referrer ?? "brak")}`,
	].join("\n");
}

export async function sendChatStartNotification(
	env: ChatNotificationEnv,
	sessionId: string,
): Promise<void> {
	const session = await env.leadgen
		.prepare(
			`SELECT id, locality_slug, business_slug, started_at, referrer, telegram_start_sent_at
       FROM chat_sessions WHERE id = ?`,
		)
		.bind(sessionId)
		.first<ChatNotificationSessionRow>();
	if (!session || session.telegram_start_sent_at) return;

	const recipient = await env.leadgen
		.prepare(
			"SELECT notify_chat_id FROM sellers WHERE notify_chat_id IS NOT NULL ORDER BY id LIMIT 1",
		)
		.first<{ notify_chat_id: string }>();
	if (!recipient) return;

	await sendMessage(
		env.TG_NOTIFY_BOT_TOKEN,
		recipient.notify_chat_id,
		formatChatStartedMessage(session),
	);

	await env.leadgen
		.prepare(
			"UPDATE chat_sessions SET telegram_start_sent_at = ? WHERE id = ? AND telegram_start_sent_at IS NULL",
		)
		.bind(new Date().toISOString(), session.id)
		.run();
}
