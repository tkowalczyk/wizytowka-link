/**
 * Single source of truth for robots + canonical decisions across every public
 * page type. Issue #84: these were copy-pasted into each `.astro` page and
 * never tested behaviorally, which is how the #81 "200 + noindex" defect shipped
 * unnoticed. Astro SSR frontmatter can't run in the workers test pool
 * (`@astrojs/cloudflare/handler` is stubbed), so the decision lives here as pure
 * functions that ARE covered, and the pages delegate to them.
 */

export const SITE_ORIGIN = "https://wizytowka.link";

/**
 * Shared social card for every indexable page type. Keeping this deterministic
 * avoids pages drifting into incomplete OpenGraph/Twitter metadata and gives
 * crawlers one stable, cacheable 1200×630 raster asset.
 */
export const SOCIAL_IMAGE = {
	url: `${SITE_ORIGIN}/og-default.png`,
	width: "1200",
	height: "630",
	alt: "wizytowka.link — lokalne firmy i usługi",
} as const;

/**
 * Robots directive for a *listing* page (locality index, category listing).
 * An empty listing is a thin page that invites GSC "Soft 404" / "Crawled —
 * currently not indexed", so it is noindexed — but kept `follow` so its
 * outbound links stay crawlable.
 */
export function robotsForListing(businessCount: number): string {
	return businessCount > 0 ? "index, follow" : "noindex, follow";
}

/**
 * Robots directive for a business page. A withheld business (non-`done`
 * site_status — owner removal, GDPR erasure, re-classification) is fully removed
 * from the index and its links are not followed: unlike a listing, a withdrawn
 * business page has nothing worth crawling.
 */
export function robotsForBusiness(isIndexable: boolean): string {
	return isIndexable ? "index, follow" : "noindex, nofollow";
}

/**
 * Canonical URL for a path on the public site: the https apex origin plus the
 * path with any trailing slash(es) removed, so `/x/` and `/x` collapse to one
 * canonical (and `/` collapses to the bare apex). Issues #81 / #84.
 */
export function canonicalFor(pathname: string): string {
	return `${SITE_ORIGIN}${pathname.replace(/\/+$/, "")}`;
}
