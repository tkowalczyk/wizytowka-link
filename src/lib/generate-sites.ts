import type { SiteData } from "../types/site";
import type { RunResult } from "./cron-log";
import { getOverrides, resolveFullTheme } from "./presentation";
import { createGLM5, generateContent, type LLMProvider } from "./site-content";
import { putSite as defaultPutSite } from "./site-store";

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

export interface GenerateSitesDeps {
	db: D1Database;
	r2: R2Bucket;
	llm: LLMProvider;
	putSite: typeof defaultPutSite;
}

// Workers scheduled handlers have a 15min wall-clock limit; we break out early
// at 12min to leave margin for in-flight GLM-5 request + D1/R2 writes.
const WALL_TIME_BUDGET_MS = 12 * 60 * 1000;

// Stale claim TTL — rows stuck in 'in_progress' longer than this are
// reclaimed by the next run. Generously above the 12min wall budget so
// in-flight claims are never accidentally stolen.
const STALE_CLAIM_TTL = "-15 minutes";

export async function runGenerateSites(
	deps: GenerateSitesDeps,
	limit = 10,
): Promise<RunResult> {
	const { db, r2, llm, putSite } = deps;

	// Atomic claim: flip up to `limit` eligible rows to 'in_progress' in a
	// single statement, returning their ids. Eligible = pending OR a stale
	// in_progress claim (recovery after crash / wall-time break).
	const claimed = await db
		.prepare(
			`UPDATE businesses
       SET site_status = 'in_progress', site_claimed_at = datetime('now')
       WHERE id IN (
         SELECT id FROM businesses
         WHERE site_status = 'pending'
            OR (site_status = 'in_progress' AND site_claimed_at < datetime('now', ?))
         LIMIT ?
       )
       RETURNING id`,
		)
		.bind(STALE_CLAIM_TTL, limit)
		.all<{ id: number }>();

	const claimedIds = claimed.results?.map((r) => r.id) ?? [];
	if (!claimedIds.length) return { processed: 0, failed: 0 };

	const placeholders = claimedIds.map(() => "?").join(", ");
	const { results } = await db
		.prepare(
			`SELECT b.*, l.name as locality_name, l.slug as loc_slug
       FROM businesses b
       JOIN localities l ON b.locality_id = l.id
       WHERE b.id IN (${placeholders})`,
		)
		.bind(...claimedIds)
		.all<BusinessRow>();

	if (!results?.length) return { processed: 0, failed: 0 };

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
			const overrides = await getOverrides(db, biz.id);
			const theme = resolveFullTheme(biz.slug, biz.category, overrides);

			const siteData: SiteData = {
				...content,
				theme: theme.paletteId,
				layout: theme.layout,
				style: theme.style,
			};

			await putSite(r2, "live", biz.loc_slug, biz.slug, siteData);

			await db
				.prepare(
					`UPDATE businesses SET site_status = 'done', site_claimed_at = NULL WHERE id = ?`,
				)
				.bind(biz.id)
				.run();

			console.log(`generated: sites/${biz.loc_slug}/${biz.slug}.json`);
			processed++;
		} catch (err) {
			console.error(`fail biz ${biz.id}: ${(err as Error).message}`);
			failed++;
			// Rollback the claim so the row is retried by a future run instead
			// of being stuck as 'in_progress' until the stale TTL kicks in.
			try {
				await db
					.prepare(
						`UPDATE businesses SET site_status = 'pending', site_claimed_at = NULL WHERE id = ?`,
					)
					.bind(biz.id)
					.run();
			} catch (rollbackErr) {
				console.error(
					`rollback fail biz ${biz.id}: ${(rollbackErr as Error).message}`,
				);
			}
		}
	}

	return { processed, failed };
}

export async function generateSites(env: Env, limit = 10): Promise<RunResult> {
	return runGenerateSites(
		{
			db: env.leadgen,
			r2: env.sites,
			llm: createGLM5(env.ZAI_API_KEY),
			putSite: defaultPutSite,
		},
		limit,
	);
}
