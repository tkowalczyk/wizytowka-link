import type { BusinessRow, LocalityRow } from "../types/business";
import { slugify } from "./slug";

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
			"SELECT DISTINCT category FROM businesses WHERE locality_id = ? AND site_generated = 1",
		)
		.bind(locality.id)
		.all<{ category: string }>();

	const match = categoryRows.find(
		(row) => slugify(row.category) === categorySlug,
	);

	if (!match) return null;

	const { results: businesses } = await db
		.prepare(
			"SELECT * FROM businesses WHERE locality_id = ? AND category = ? AND site_generated = 1 ORDER BY rating DESC",
		)
		.bind(locality.id, match.category)
		.all<BusinessRow>();

	return { locality, categoryName: match.category, businesses };
}
