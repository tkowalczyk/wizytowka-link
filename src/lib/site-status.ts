export type SiteStatus = "pending" | "in_progress" | "done" | "ineligible";
export type SiteIneligibleReason = "has_website" | "no_phone";

export interface SiteStatusClassification {
	status: SiteStatus;
	reason: SiteIneligibleReason | null;
}

/**
 * Classifies whether a business is eligible for site generation based on the
 * presence of website and phone. Priority: website > phone — if a business
 * already has a website it is ineligible regardless of phone status.
 */
export function classifyBusinessSiteStatus(biz: {
	website: string | null;
	phone: string | null;
}): SiteStatusClassification {
	if (biz.website) return { status: "ineligible", reason: "has_website" };
	if (!biz.phone) return { status: "ineligible", reason: "no_phone" };
	return { status: "pending", reason: null };
}
