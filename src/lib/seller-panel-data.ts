import type { SellerRow } from "../types/business";
import {
	type LeadFilters,
	type LeadPage,
	Leads,
	type LocalityOption,
} from "./leads";
import {
	loadRecentSellerChats,
	loadSellerChatEvidence,
	type SellerChatEvidence,
	type SellerRecentChat,
} from "./seller-evidence";

export interface SellerPanelRouteData {
	seller: SellerRow;
	leadPage: LeadPage;
	localities: LocalityOption[];
	currentStatus: string;
	currentLocality: string;
	currentSite: NonNullable<LeadFilters["site"]>;
	currentSort: NonNullable<LeadFilters["sort"]>;
	page: number;
	chatEvidence: SellerChatEvidence | null;
	recentChats: SellerRecentChat[];
}

export async function loadSellerPanelRouteData(
	db: D1Database,
	token: string,
	url: URL,
): Promise<SellerPanelRouteData | null> {
	const leads = new Leads(db);
	const seller = await leads.authenticate(token);
	if (!seller) return null;

	const statusFilter = url.searchParams.get("status") || "all";
	const localityFilter = url.searchParams.get("locality") || undefined;
	const siteFilter =
		(url.searchParams.get("site") as LeadFilters["site"]) ?? "generated";
	const sortBy =
		(url.searchParams.get("sort") as LeadFilters["sort"]) ?? "date";
	const rawPage = url.searchParams.get("page") || "1";
	const parsedPage = parseInt(rawPage, 10);
	const page = Number.isNaN(parsedPage) ? 1 : Math.max(1, parsedPage);
	const chatSessionId = url.searchParams.get("chat");

	const chatEvidence = chatSessionId
		? await loadSellerChatEvidence(db, token, chatSessionId)
		: null;
	if (chatSessionId && !chatEvidence) return null;

	const [leadPage, localities, recentChats] = await Promise.all([
		leads.list(seller.id, {
			status: statusFilter as LeadFilters["status"],
			locality: localityFilter,
			site: siteFilter,
			sort: sortBy,
			page,
		}),
		leads.localities(),
		loadRecentSellerChats(db, 20),
	]);

	return {
		seller,
		leadPage,
		localities,
		currentStatus: statusFilter,
		currentLocality: localityFilter || "",
		currentSite: siteFilter,
		currentSort: sortBy,
		page,
		chatEvidence,
		recentChats,
	};
}
