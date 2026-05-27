import type { SellerRow } from "../types/business";
import { Leads } from "./leads";

export interface SellerChatEvidenceSession {
	id: string;
	localitySlug: string;
	businessSlug: string;
	startedAt: string;
	endedAt: string | null;
	status: "active" | "ended";
	referrer: string | null;
	userAgent: string | null;
	endReason: "visitor" | "timeout" | null;
	messageCount: number | null;
	intentSummary: string | null;
	intentCategories: string[];
	hasComplaint: boolean;
	hasCommercialDemand: boolean;
}

export interface SellerChatEvidenceMessage {
	role: "visitor" | "assistant";
	content: string;
	messageIndex: number;
	createdAt: string;
}

export interface SellerChatEvidenceMetrics {
	pageVisits: number;
	chatStarts: number;
	chatStartRate: number;
	totalChats: number;
	totalMessageCount: number;
	averageMessageCount: number;
	specificIntentCount: number;
	repeatedDemandCount: number;
	commercialDemandCount: number;
	complaintCount: number;
}

export interface SellerRecentChat {
	id: string;
	localitySlug: string;
	businessSlug: string;
	startedAt: string;
	endedAt: string | null;
	status: "active" | "ended";
	endReason: "visitor" | "timeout" | null;
	messageCount: number | null;
	intentSummary: string | null;
	hasComplaint: boolean;
	hasCommercialDemand: boolean;
}

export interface SellerChatEvidence {
	seller: SellerRow;
	session: SellerChatEvidenceSession;
	messages: SellerChatEvidenceMessage[];
	metrics: SellerChatEvidenceMetrics;
}

interface ChatEvidenceSessionRow {
	id: string;
	locality_slug: string;
	business_slug: string;
	started_at: string;
	ended_at: string | null;
	status: "active" | "ended";
	referrer: string | null;
	user_agent: string | null;
	end_reason: "visitor" | "timeout" | null;
	message_count: number | null;
	intent_summary: string | null;
	intent_categories: string | null;
	has_complaint: number;
	has_commercial_demand: number;
}

interface ChatEvidenceMessageRow {
	role: "visitor" | "assistant";
	content: string;
	message_index: number;
	created_at: string;
}

interface ChatEvidenceAnalyticsRow {
	page_visits: number | null;
	chat_starts: number | null;
}

interface ChatEvidenceMetricRow {
	total_chats: number | null;
	total_message_count: number | null;
	average_message_count: number | null;
	specific_intent_count: number | null;
	commercial_demand_count: number | null;
	complaint_count: number | null;
}

interface RecentChatRow {
	id: string;
	locality_slug: string;
	business_slug: string;
	started_at: string;
	ended_at: string | null;
	status: "active" | "ended";
	end_reason: "visitor" | "timeout" | null;
	message_count: number | null;
	intent_summary: string | null;
	has_complaint: number;
	has_commercial_demand: number;
}

function parseCategories(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is string => typeof item === "string");
	} catch {
		return [];
	}
}

function mapSession(row: ChatEvidenceSessionRow): SellerChatEvidenceSession {
	return {
		id: row.id,
		localitySlug: row.locality_slug,
		businessSlug: row.business_slug,
		startedAt: row.started_at,
		endedAt: row.ended_at,
		status: row.status,
		referrer: row.referrer,
		userAgent: row.user_agent,
		endReason: row.end_reason,
		messageCount: row.message_count,
		intentSummary: row.intent_summary,
		intentCategories: parseCategories(row.intent_categories),
		hasComplaint: row.has_complaint === 1,
		hasCommercialDemand: row.has_commercial_demand === 1,
	};
}

function mapMessage(row: ChatEvidenceMessageRow): SellerChatEvidenceMessage {
	return {
		role: row.role,
		content: row.content,
		messageIndex: row.message_index,
		createdAt: row.created_at,
	};
}

function mapRecentChat(row: RecentChatRow): SellerRecentChat {
	return {
		id: row.id,
		localitySlug: row.locality_slug,
		businessSlug: row.business_slug,
		startedAt: row.started_at,
		endedAt: row.ended_at,
		status: row.status,
		endReason: row.end_reason,
		messageCount: row.message_count,
		intentSummary: row.intent_summary,
		hasComplaint: row.has_complaint === 1,
		hasCommercialDemand: row.has_commercial_demand === 1,
	};
}

async function loadMetrics(
	db: D1Database,
	localitySlug: string,
	businessSlug: string,
): Promise<SellerChatEvidenceMetrics> {
	const [analyticsResult, metricResult] = await db.batch([
		db
			.prepare(
				`SELECT
           SUM(CASE WHEN event_type = 'page_visit' THEN 1 ELSE 0 END) AS page_visits,
           SUM(CASE WHEN event_type = 'chat_start' THEN 1 ELSE 0 END) AS chat_starts
         FROM analytics_events
         WHERE locality_slug = ? AND business_slug = ?`,
			)
			.bind(localitySlug, businessSlug),
		db
			.prepare(
				`SELECT
           COUNT(*) AS total_chats,
           COALESCE(SUM(COALESCE(message_count, 0)), 0) AS total_message_count,
           COALESCE(AVG(COALESCE(message_count, 0)), 0) AS average_message_count,
           SUM(CASE
             WHEN intent_categories IS NOT NULL AND intent_categories != '[]' THEN 1
             ELSE 0
           END) AS specific_intent_count,
           COALESCE(SUM(has_commercial_demand), 0) AS commercial_demand_count,
           COALESCE(SUM(has_complaint), 0) AS complaint_count
         FROM chat_sessions
         WHERE locality_slug = ? AND business_slug = ?`,
			)
			.bind(localitySlug, businessSlug),
	]);
	const analytics = (analyticsResult as D1Result<ChatEvidenceAnalyticsRow>)
		.results?.[0];
	const metrics = (metricResult as D1Result<ChatEvidenceMetricRow>)
		.results?.[0];
	const pageVisits = Number(analytics?.page_visits ?? 0);
	const chatStarts = Number(analytics?.chat_starts ?? 0);
	const commercialDemandCount = Number(metrics?.commercial_demand_count ?? 0);

	return {
		pageVisits,
		chatStarts,
		chatStartRate: pageVisits > 0 ? chatStarts / pageVisits : 0,
		totalChats: Number(metrics?.total_chats ?? 0),
		totalMessageCount: Number(metrics?.total_message_count ?? 0),
		averageMessageCount: Number(metrics?.average_message_count ?? 0),
		specificIntentCount: Number(metrics?.specific_intent_count ?? 0),
		repeatedDemandCount: commercialDemandCount,
		commercialDemandCount,
		complaintCount: Number(metrics?.complaint_count ?? 0),
	};
}

export async function loadSellerChatEvidence(
	db: D1Database,
	sellerToken: string,
	sessionId: string,
): Promise<SellerChatEvidence | null> {
	const leads = new Leads(db);
	const seller = await leads.authenticate(sellerToken);
	if (!seller) return null;

	const session = await db
		.prepare(
			`SELECT id, locality_slug, business_slug, started_at, ended_at, status,
              referrer, user_agent, end_reason, message_count, intent_summary,
              intent_categories, has_complaint, has_commercial_demand
       FROM chat_sessions
       WHERE id = ?`,
		)
		.bind(sessionId)
		.first<ChatEvidenceSessionRow>();
	if (!session) return null;

	const result = await db
		.prepare(
			`SELECT role, content, message_index, created_at
       FROM chat_messages
       WHERE session_id = ?
       ORDER BY message_index`,
		)
		.bind(session.id)
		.all<ChatEvidenceMessageRow>();
	const metrics = await loadMetrics(
		db,
		session.locality_slug,
		session.business_slug,
	);

	return {
		seller,
		session: mapSession(session),
		messages: result.results.map(mapMessage),
		metrics,
	};
}

export async function loadRecentSellerChats(
	db: D1Database,
	limit = 20,
): Promise<SellerRecentChat[]> {
	const result = await db
		.prepare(
			`SELECT id, locality_slug, business_slug, started_at, ended_at, status,
              end_reason, message_count, intent_summary,
              has_complaint, has_commercial_demand
       FROM chat_sessions
       ORDER BY started_at DESC
       LIMIT ?`,
		)
		.bind(limit)
		.all<RecentChatRow>();
	return result.results.map(mapRecentChat);
}
