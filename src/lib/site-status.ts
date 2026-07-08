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
/**
 * Whether a business may be served on its public page and .md export, and
 * indexed. Issue #72 gap 2: routes previously served any live R2 object
 * regardless of status, so a business flipped off 'done' (owner removal, GDPR
 * erasure, re-classification) stayed live + indexable while vanishing from
 * every list. Only 'done' is public — everything else means withdrawn (410).
 * Mirrors the `site_status='done'` filter used by all listing surfaces.
 */
export function isPubliclyServable(
	siteStatus: SiteStatus | string | null | undefined,
): boolean {
	return siteStatus === "done";
}

export function classifyBusinessSiteStatus(biz: {
	website: string | null;
	phone: string | null;
}): SiteStatusClassification {
	if (biz.website) return { status: "ineligible", reason: "has_website" };
	if (!biz.phone) return { status: "ineligible", reason: "no_phone" };
	return { status: "pending", reason: null };
}
