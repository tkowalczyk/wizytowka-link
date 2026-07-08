import type { BusinessRow, LocalityRow } from "../types/business";
import { slugify } from "./slug";

export interface CategoryCount {
	categoryName: string;
	slug: string;
	count: number;
}

export interface CategoryResult {
	locality: LocalityRow;
	categoryName: string;
	businesses: BusinessRow[];
}

export async function findCategoryBusinesses(
	db: D1Database,
	locSlug: string,
	categorySlug: string,
): Promise<CategoryResult | null> {
	const locality = await db
		.prepare("SELECT * FROM localities WHERE slug = ?")
		.bind(locSlug)
		.first<LocalityRow>();

	if (!locality) return null;

	const { results: categoryRows } = await db
		.prepare(
			"SELECT DISTINCT category FROM businesses WHERE locality_id = ? AND site_status = 'done'",
		)
		.bind(locality.id)
		.all<{ category: string }>();

	const matches = categoryRows
		.filter((row) => slugify(row.category) === categorySlug)
		.map((row) => row.category)
		.sort();

	if (matches.length === 0) return null;

	const placeholders = matches.map(() => "?").join(", ");

	const { results: businesses } = await db
		.prepare(
			`SELECT * FROM businesses WHERE locality_id = ? AND category IN (${placeholders}) AND site_status = 'done' ORDER BY rating DESC`,
		)
		.bind(locality.id, ...matches)
		.all<BusinessRow>();

	return { locality, categoryName: matches[0], businesses };
}

export async function findLocalityCategories(
	db: D1Database,
	locSlug: string,
): Promise<CategoryCount[]> {
	const locality = await db
		.prepare("SELECT id FROM localities WHERE slug = ?")
		.bind(locSlug)
		.first<{ id: number }>();

	if (!locality) return [];

	const { results } = await db
		.prepare(
			"SELECT category, COUNT(*) AS count FROM businesses WHERE locality_id = ? AND site_status = 'done' GROUP BY category",
		)
		.bind(locality.id)
		.all<{ category: string; count: number }>();

	return results.map((row) => ({
		categoryName: row.category,
		slug: slugify(row.category),
		count: row.count,
	}));
}
