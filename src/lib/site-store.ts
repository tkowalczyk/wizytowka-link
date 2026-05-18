import type { SiteData } from "../types/site";
import { verifyDraftPreviewToken } from "./draft-preview";

export type SiteNamespace = "live" | "draft";

export function siteKey(
	ns: SiteNamespace,
	locSlug: string,
	bizSlug: string,
): string {
	return ns === "draft"
		? `sites/draft/${locSlug}/${bizSlug}.json`
		: `sites/${locSlug}/${bizSlug}.json`;
}

export async function getSite(
	r2: R2Bucket,
	ns: SiteNamespace,
	locSlug: string,
	bizSlug: string,
): Promise<SiteData | null> {
	const obj = await r2.get(siteKey(ns, locSlug, bizSlug));
	if (!obj) return null;
	return obj.json<SiteData>();
}

export async function getPublishedOrPreviewSite(
	r2: R2Bucket,
	db: D1Database,
	locSlug: string,
	bizSlug: string,
	options: { isDraft: boolean; previewToken: string | null },
): Promise<SiteData | null> {
	if (options.isDraft) {
		const canPreview = await verifyDraftPreviewToken(
			db,
			locSlug,
			bizSlug,
			options.previewToken,
		);
		if (!canPreview) return null;
	}

	return getSite(r2, options.isDraft ? "draft" : "live", locSlug, bizSlug);
}

export async function putSite(
	r2: R2Bucket,
	ns: SiteNamespace,
	locSlug: string,
	bizSlug: string,
	data: SiteData,
): Promise<void> {
	await r2.put(siteKey(ns, locSlug, bizSlug), JSON.stringify(data), {
		httpMetadata: { contentType: "application/json" },
	});
}

export async function promoteDraft(
	r2: R2Bucket,
	locSlug: string,
	bizSlug: string,
): Promise<boolean> {
	const draft = await getSite(r2, "draft", locSlug, bizSlug);
	if (!draft) return false;
	await putSite(r2, "live", locSlug, bizSlug, draft);
	await r2.delete(siteKey("draft", locSlug, bizSlug));
	return true;
}

export async function deleteSite(
	r2: R2Bucket,
	ns: SiteNamespace,
	locSlug: string,
	bizSlug: string,
): Promise<void> {
	await r2.delete(siteKey(ns, locSlug, bizSlug));
}
