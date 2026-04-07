import type { CallLogRow, SellerRow } from "../types/business";
import { normalizePhone } from "./phone";
import { generateOwnerToken } from "./token";

export type LeadStatus = CallLogRow["status"];

export interface LeadFilters {
	status?: LeadStatus | "all";
	locality?: string;
	site?: "generated" | "none" | "all";
	sort?: "date" | "status";
	page?: number;
	pageSize?: number;
}

export interface Lead {
	id: number;
	title: string;
	phone: string;
	address: string;
	category: string;
	rating: number | null;
	biz_slug: string;
	loc_slug: string;
	locality_name: string;
	site_generated: number;
	status: LeadStatus;
	comment: string | null;
	created_at: string;
}

export interface LeadPage {
	leads: Lead[];
	total: number;
	page: number;
	totalPages: number;
}

export interface LocalityOption {
	slug: string;
	name: string;
	pow_name: string;
	woj_name: string;
	gmi_name: string;
}

export interface PhoneMatch {
	id: number;
	title: string;
	category: string;
	slug: string;
	locality_name: string;
	locality_slug: string;
}

function buildLeadQuery(
	sellerId: number,
	filters: LeadFilters,
	mode: "rows" | "count",
): { sql: string; params: (string | number)[] } {
	const params: (string | number)[] = [sellerId];

	const select =
		mode === "rows"
			? `SELECT b.id, b.title, b.phone, b.address, b.category, b.rating,
           b.slug as biz_slug, l.slug as loc_slug, l.name as locality_name,
           b.site_generated,
           COALESCE(cl.status, 'pending') as status,
           cl.comment,
           b.created_at`
			: `SELECT COUNT(*) as cnt`;

	let sql = `${select}
  FROM businesses b
  JOIN localities l ON b.locality_id = l.id
  LEFT JOIN (
    SELECT business_id, status, comment,
      ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC) as rn
    FROM call_log WHERE seller_id = ?1
  ) cl ON cl.business_id = b.id AND cl.rn = 1
  WHERE b.website IS NULL AND b.phone IS NOT NULL`;

	if (filters.status && filters.status !== "all") {
		if (filters.status === "pending") {
			sql += ` AND (cl.status IS NULL OR cl.status = 'pending')`;
		} else {
			sql += ` AND cl.status = ?${params.length + 1}`;
			params.push(filters.status);
		}
	}

	if (filters.site === "generated") {
		sql += ` AND b.site_generated = 1`;
	} else if (filters.site === "none") {
		sql += ` AND b.site_generated = 0`;
	}

	if (filters.locality) {
		sql += ` AND l.slug = ?${params.length + 1}`;
		params.push(filters.locality);
	}

	if (mode === "rows") {
		if (filters.sort === "status") {
			sql += ` ORDER BY cl.status ASC, b.created_at DESC`;
		} else {
			sql += ` ORDER BY b.created_at DESC`;
		}

		const pageSize = filters.pageSize ?? 50;
		const page = filters.page ?? 1;
		sql += ` LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
		params.push(pageSize, (page - 1) * pageSize);
	}

	return { sql, params };
}

export class Leads {
	constructor(private db: D1Database) {}

	static extractToken(request: Request): string | null {
		const header = request.headers.get("X-Seller-Token");
		if (header) return header;
		const url = new URL(request.url);
		return url.searchParams.get("token");
	}

	async authenticate(token: string): Promise<SellerRow | null> {
		return this.db
			.prepare("SELECT * FROM sellers WHERE token = ?")
			.bind(token)
			.first<SellerRow>();
	}

	async businessExists(id: number): Promise<boolean> {
		const row = await this.db
			.prepare("SELECT id FROM businesses WHERE id = ?")
			.bind(id)
			.first();
		return row !== null;
	}

	async list(sellerId: number, filters: LeadFilters = {}): Promise<LeadPage> {
		const rows = buildLeadQuery(sellerId, filters, "rows");
		const count = buildLeadQuery(sellerId, filters, "count");

		const [rowsResult, countResult] = await this.db.batch([
			this.db.prepare(rows.sql).bind(...rows.params),
			this.db.prepare(count.sql).bind(...count.params),
		]);

		const leads = (rowsResult as D1Result<Lead>).results ?? [];
		const total =
			(countResult as D1Result<{ cnt: number }>).results?.[0]?.cnt ?? 0;
		const pageSize = filters.pageSize ?? 50;
		const page = filters.page ?? 1;

		return {
			leads,
			total,
			page,
			totalPages: Math.ceil(total / pageSize),
		};
	}

	async localities(): Promise<LocalityOption[]> {
		const result = await this.db
			.prepare(
				`SELECT DISTINCT l.slug, l.name, l.pow_name, l.woj_name, l.gmi_name
         FROM localities l
         JOIN businesses b ON b.locality_id = l.id
         WHERE b.website IS NULL AND b.phone IS NOT NULL
         ORDER BY l.name`,
			)
			.all<LocalityOption>();
		return result.results ?? [];
	}

	async logStatus(
		businessId: number,
		sellerId: number,
		status: LeadStatus,
		comment?: string | null,
	): Promise<void> {
		await this.db
			.prepare(
				"INSERT INTO call_log (business_id, seller_id, status, comment) VALUES (?, ?, ?, ?)",
			)
			.bind(businessId, sellerId, status, comment ?? null)
			.run();
	}

	async updateComment(
		businessId: number,
		sellerId: number,
		comment: string,
	): Promise<void> {
		await this.db
			.prepare(
				`UPDATE call_log SET comment = ?
         WHERE id = (SELECT id FROM call_log WHERE business_id = ? AND seller_id = ? ORDER BY created_at DESC LIMIT 1)`,
			)
			.bind(comment, businessId, sellerId)
			.run();
	}

	async matchByPhone(phone: string): Promise<PhoneMatch[]> {
		const normalized = normalizePhone(phone);
		if (!normalized) return [];
		const digits = normalized.replace("+48", "");
		const result = await this.db
			.prepare(
				`SELECT b.id, b.title, b.category, b.slug, l.name as locality_name, l.slug as locality_slug
         FROM businesses b
         JOIN localities l ON b.locality_id = l.id
         WHERE REPLACE(REPLACE(REPLACE(b.phone, ' ', ''), '-', ''), '+48', '') = ?`,
			)
			.bind(digits)
			.all<PhoneMatch>();
		return result.results ?? [];
	}

	async ensureOwnerToken(businessId: number): Promise<string> {
		const existing = await this.db
			.prepare("SELECT token FROM business_owners WHERE business_id = ?")
			.bind(businessId)
			.first<{ token: string }>();
		if (existing) return existing.token;

		const token = generateOwnerToken();
		await this.db
			.prepare("INSERT INTO business_owners (business_id, token) VALUES (?, ?)")
			.bind(businessId, token)
			.run();
		return token;
	}
}
