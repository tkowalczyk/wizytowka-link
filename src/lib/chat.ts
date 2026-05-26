import type { SiteData } from "../types/site";
import { getSite } from "./site-store";
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

export interface ChatMessageInput {
	sessionId: string;
	content: string;
}

export interface AssistantChatMessage {
	role: "assistant";
	content: string;
	createdAt: string;
}

export type ChatMessageResult =
	| { status: "ok"; message: AssistantChatMessage }
	| { status: "not_found" }
	| { status: "ended" };

export interface ChatLLMMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface ChatLLMProvider {
	complete(messages: ChatLLMMessage[]): Promise<string>;
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

interface ChatSessionRow {
	id: string;
	business_id: number;
	locality_slug: string;
	business_slug: string;
	status: "active" | "ended";
	referrer: string | null;
	user_agent: string | null;
}

interface ChatBusinessContextRow {
	title: string;
	category: string;
	address: string | null;
	phone: string | null;
	website: string | null;
	description: string | null;
	operating_hours: string | null;
	rating: number | null;
	reviews_count: number | null;
}

interface StoredChatMessageRow {
	role: "visitor" | "assistant";
	content: string;
	message_index: number;
	created_at: string;
}

interface AllowedChatContext {
	business: {
		title: string;
		category: string;
		address: string | null;
		openingHours: string | null;
		description: string | null;
		rating: number | null;
		reviewsCount: number | null;
	};
	generatedPage: {
		hero: SiteData["hero"];
		about: SiteData["about"];
		services: SiteData["services"];
		contact: { address: string };
		seo: SiteData["seo"];
	} | null;
	session: {
		localitySlug: string;
		businessSlug: string;
		referrer: string | null;
		userAgent: string | null;
	};
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

export function parseChatMessageInput(body: unknown): ChatMessageInput | null {
	if (typeof body !== "object" || body === null) return null;
	const data = body as Record<string, unknown>;
	if (!isNonEmptyString(data.sessionId) || !isNonEmptyString(data.content)) {
		return null;
	}
	return {
		sessionId: data.sessionId.trim(),
		content: data.content.trim(),
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

const CHAT_MODEL = "glm-5";
const CHAT_TEMPERATURE = 0.2;
const CHAT_MAX_TOKENS = 300;
const PROVIDER_ERROR_BODY_CAP_BYTES = 2048;
const ZAI_CHAT_COMPLETIONS_URL =
	"https://api.z.ai/api/coding/paas/v4/chat/completions";
const CHAT_SYSTEM_PROMPT = `Jestes polskim asystentem informacyjnym strony wizytowkowej.
Odpowiadasz tylko na podstawie dozwolonego kontekstu strony i metadanych firmy.
Jesli informacji nie ma w kontekście, powiedz krotko, ze nie wiesz.
Nigdy nie podawaj numeru telefonu, adresu e-mail, strony WWW ani bezposredniego linku kontaktowego.
Dla rezerwacji, cen, dostepnosci, reklamacji i pracy wyjasnij krotko, ze sprawa wymaga kontaktu z czlowiekiem lub oficjalnym kanalem firmy.
Odpowiadaj zwiezle po polsku.`;

export function createZAIChatProvider(
	apiKey: string,
	fetchImpl: typeof fetch = fetch,
): ChatLLMProvider {
	return {
		async complete(messages) {
			const response = await fetchImpl(ZAI_CHAT_COMPLETIONS_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: CHAT_MODEL,
					messages,
					stream: false,
					thinking: { type: "disabled" },
					temperature: CHAT_TEMPERATURE,
					max_tokens: CHAT_MAX_TOKENS,
				}),
			});
			if (!response.ok) {
				const text = await readProviderBodyCapped(
					response,
					PROVIDER_ERROR_BODY_CAP_BYTES,
				);
				throw new Error(`Z.AI chat failed with ${response.status}: ${text}`);
			}
			const data = (await response.json()) as {
				choices?: { message?: { content?: unknown } }[];
			};
			const content = data.choices?.[0]?.message?.content;
			if (typeof content !== "string" || content.trim().length === 0) {
				throw new Error("Z.AI chat returned an unusable response");
			}
			return content.trim();
		},
	};
}

async function readProviderBodyCapped(
	response: Response,
	maxBytes: number,
): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (total < maxBytes) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			total += value.byteLength;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	const merged = new Uint8Array(Math.min(total, maxBytes));
	let offset = 0;
	for (const chunk of chunks) {
		const remaining = merged.byteLength - offset;
		if (remaining <= 0) break;
		const slice =
			chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
		merged.set(slice, offset);
		offset += slice.byteLength;
	}
	return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

async function findChatSession(
	db: D1Database,
	sessionId: string,
): Promise<ChatSessionRow | null> {
	return db
		.prepare(
			`SELECT id, business_id, locality_slug, business_slug, status, referrer, user_agent
       FROM chat_sessions
       WHERE id = ?`,
		)
		.bind(sessionId)
		.first<ChatSessionRow>();
}

async function nextMessageIndex(
	db: D1Database,
	sessionId: string,
): Promise<number> {
	const row = await db
		.prepare(
			"SELECT COALESCE(MAX(message_index), 0) + 1 AS next_index FROM chat_messages WHERE session_id = ?",
		)
		.bind(sessionId)
		.first<{ next_index: number }>();
	return row?.next_index ?? 1;
}

async function appendChatMessage(
	db: D1Database,
	session: ChatSessionRow,
	role: "visitor" | "assistant",
	content: string,
): Promise<StoredChatMessageRow> {
	const createdAt = new Date().toISOString();
	const messageIndex = await nextMessageIndex(db, session.id);
	await db
		.prepare(
			`INSERT INTO chat_messages (
         id, session_id, locality_slug, business_slug, role, content, message_index, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			crypto.randomUUID(),
			session.id,
			session.locality_slug,
			session.business_slug,
			role,
			content,
			messageIndex,
			createdAt,
		)
		.run();
	return {
		role,
		content,
		message_index: messageIndex,
		created_at: createdAt,
	};
}

function redactDirectContactInfo(value: string): string {
	return value
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
		.replace(/https?:\/\/[^\s)]+/gi, "[redacted]")
		.replace(/\+?\d(?:[\s().-]?\d){8,}/g, "[redacted]");
}

function cleanNullableText(value: string | null): string | null {
	if (!value) return null;
	const cleaned = redactDirectContactInfo(value).trim();
	return cleaned.length > 0 ? cleaned : null;
}

function cleanText(value: string): string {
	return redactDirectContactInfo(value).trim();
}

function redactedSite(site: SiteData | null) {
	if (!site) return null;
	return {
		hero: {
			headline: cleanText(site.hero.headline),
			subheadline: cleanText(site.hero.subheadline),
		},
		about: {
			title: cleanText(site.about.title),
			text: cleanText(site.about.text),
		},
		services: site.services.map((service) => ({
			name: cleanText(service.name),
			description: cleanText(service.description),
		})),
		contact: { address: cleanText(site.contact.address) },
		seo: {
			title: cleanText(site.seo.title),
			description: cleanText(site.seo.description),
		},
	};
}

async function loadChatContext(
	db: D1Database,
	r2: R2Bucket,
	session: ChatSessionRow,
): Promise<{ allowed: AllowedChatContext; sensitiveValues: string[] }> {
	const business = await db
		.prepare(
			`SELECT title, category, address, phone, website, description, operating_hours, rating, reviews_count
       FROM businesses
       WHERE id = ?`,
		)
		.bind(session.business_id)
		.first<ChatBusinessContextRow>();
	if (!business) throw new Error("chat session business missing");

	const site = await getSite(
		r2,
		"live",
		session.locality_slug,
		session.business_slug,
	).catch(() => null);
	const redactedGeneratedPage = redactedSite(site);

	return {
		allowed: {
			business: {
				title: cleanText(business.title),
				category: cleanText(business.category),
				address: cleanNullableText(business.address),
				openingHours: cleanNullableText(business.operating_hours),
				description: cleanNullableText(business.description),
				rating: business.rating,
				reviewsCount: business.reviews_count,
			},
			generatedPage: redactedGeneratedPage,
			session: {
				localitySlug: session.locality_slug,
				businessSlug: session.business_slug,
				referrer: cleanNullableText(session.referrer),
				userAgent: cleanNullableText(session.user_agent),
			},
		},
		sensitiveValues: [
			business.phone,
			business.website,
			site?.contact.phone,
		].filter(isNonEmptyString),
	};
}

async function loadTranscript(
	db: D1Database,
	sessionId: string,
): Promise<StoredChatMessageRow[]> {
	const result = await db
		.prepare(
			`SELECT role, content, message_index, created_at
       FROM chat_messages
       WHERE session_id = ?
       ORDER BY message_index`,
		)
		.bind(sessionId)
		.all<StoredChatMessageRow>();
	return result.results;
}

function buildProviderMessages(
	context: AllowedChatContext,
	transcript: StoredChatMessageRow[],
): ChatLLMMessage[] {
	return [
		{
			role: "system",
			content: `${CHAT_SYSTEM_PROMPT}\n\nDOZWOLONY_KONTEKST_JSON:\n${JSON.stringify(context)}`,
		},
		...transcript.map(
			(message) =>
				({
					role: message.role === "visitor" ? "user" : "assistant",
					content: message.content,
				}) satisfies ChatLLMMessage,
		),
	];
}

function includesSensitiveValue(
	content: string,
	sensitiveValues: string[],
): boolean {
	const normalized = content.toLowerCase();
	return sensitiveValues.some((value) =>
		normalized.includes(value.toLowerCase()),
	);
}

function containsDirectContactInfo(content: string): boolean {
	return redactDirectContactInfo(content) !== content;
}

function searchableText(content: string): string {
	return content
		.toLowerCase()
		.replace(/ł/g, "l")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "");
}

function isDirectContactRequest(content: string): boolean {
	return /(telefon|numer|email|e-mail|mail|stron[aye]|www|link|kontakt)/.test(
		searchableText(content),
	);
}

function isActionIntent(content: string): boolean {
	return /(rezerw|umow|termin|cennik|cena|koszt|wycena|dostepn|reklamac|skarg|praca|zatrudni|cv|etat)/.test(
		searchableText(content),
	);
}

function isLikelyUngroundedQuestion(content: string): boolean {
	return /(wlasciciel|nip|regon|krs|rok zalozenia|kiedy powstala|konto bankowe|platnosc|parking|facebook|instagram)/.test(
		searchableText(content),
	);
}

function humanChannelGuidance(context: AllowedChatContext): string {
	const details = [
		context.business.address ? `Adres: ${context.business.address}.` : null,
		context.business.openingHours
			? `Godziny: ${context.business.openingHours}.`
			: null,
	].filter(isNonEmptyString);
	return [
		"Ta sprawa wymaga kontaktu z człowiekiem lub oficjalnym kanałem firmy.",
		...details,
	].join(" ");
}

function providerFailureFallback(): string {
	return "Nie mogę teraz odpowiedzieć na podstawie danych tej strony. Sprawy wymagające kontaktu z człowiekiem załatw przez oficjalny kanał firmy.";
}

function unknownAnswerFallback(): string {
	return "Nie wiem na podstawie danych tej strony. W sprawach wymagających potwierdzenia skorzystaj z oficjalnego kanału firmy.";
}

function applyResponseGuardrails(
	response: string,
	visitorContent: string,
	context: AllowedChatContext,
	sensitiveValues: string[],
): string {
	if (
		isDirectContactRequest(visitorContent) ||
		isActionIntent(visitorContent)
	) {
		return humanChannelGuidance(context);
	}
	if (isLikelyUngroundedQuestion(visitorContent)) {
		return unknownAnswerFallback();
	}
	if (
		containsDirectContactInfo(response) ||
		includesSensitiveValue(response, sensitiveValues)
	) {
		return humanChannelGuidance(context);
	}
	return response.trim();
}

export async function sendChatMessage(
	db: D1Database,
	r2: R2Bucket,
	input: ChatMessageInput,
	llm: ChatLLMProvider,
): Promise<ChatMessageResult> {
	const session = await findChatSession(db, input.sessionId);
	if (!session) return { status: "not_found" };
	if (session.status !== "active") return { status: "ended" };

	await appendChatMessage(db, session, "visitor", input.content);
	const { allowed, sensitiveValues } = await loadChatContext(db, r2, session);
	const transcript = await loadTranscript(db, session.id);

	let assistantContent: string;
	try {
		assistantContent = await llm.complete(
			buildProviderMessages(allowed, transcript),
		);
		assistantContent = applyResponseGuardrails(
			assistantContent,
			input.content,
			allowed,
			sensitiveValues,
		);
	} catch (error) {
		console.error("chat assistant provider failed:", error);
		assistantContent = providerFailureFallback();
	}

	const assistant = await appendChatMessage(
		db,
		session,
		"assistant",
		assistantContent,
	);
	return {
		status: "ok",
		message: {
			role: "assistant",
			content: assistant.content,
			createdAt: assistant.created_at,
		},
	};
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
