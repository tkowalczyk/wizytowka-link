import type { SiteData } from "../types/site";
import type { RunResult } from "./cron-log";
import { getOverrides, resolveFullTheme } from "./presentation";
import { createGLM5, generateContent } from "./site-content";
import { putSite } from "./site-store";

interface BusinessRow {
	id: number;
	title: string;
	category: string;
	address: string;
	phone: string;
	rating: number | null;
	slug: string;
	locality_name: string;
	loc_slug: string;
}

// Workers scheduled handlers have a 15min wall-clock limit; we break out early
// at 12min to leave margin for in-flight GLM-5 request + D1/R2 writes.
const WALL_TIME_BUDGET_MS = 12 * 60 * 1000;

export async function generateSites(env: Env, limit = 10): Promise<RunResult> {
	const { results } = await env.leadgen
		.prepare(`
    SELECT b.*, l.name as locality_name, l.slug as loc_slug
    FROM businesses b
    JOIN localities l ON b.locality_id = l.id
    WHERE b.website IS NULL AND b.phone IS NOT NULL AND b.site_generated = 0
    LIMIT ?
  `)
		.bind(limit)
		.all<BusinessRow>();

	if (!results?.length) return { processed: 0, failed: 0 };

	const llm = createGLM5(env.ZAI_API_KEY);
	const startMs = Date.now();
	let processed = 0;
	let failed = 0;

	for (const biz of results) {
		if (Date.now() - startMs > WALL_TIME_BUDGET_MS) {
			console.log(
				`wall-time budget exceeded at biz ${biz.id}, stopping batch (processed=${processed})`,
			);
			break;
		}
		try {
			const content = await generateContent(llm, biz);
			const overrides = await getOverrides(env.leadgen, biz.id);
			const theme = resolveFullTheme(biz.slug, biz.category, overrides);

			const siteData: SiteData = {
				...content,
				theme: theme.paletteId,
				layout: theme.layout,
				style: theme.style,
			};

			await putSite(env.sites, "live", biz.loc_slug, biz.slug, siteData);

			await env.leadgen
				.prepare(`UPDATE businesses SET site_generated = 1 WHERE id = ?`)
				.bind(biz.id)
				.run();

			console.log(`generated: sites/${biz.loc_slug}/${biz.slug}.json`);
			processed++;
		} catch (err) {
			console.error(`fail biz ${biz.id}: ${(err as Error).message}`);
			failed++;
		}
	}

	return { processed, failed };
}
