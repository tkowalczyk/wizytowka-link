const DEFAULT_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export interface CreateDraftPreviewTokenOptions {
	now?: Date;
	ttlMs?: number;
}

function generatePreviewToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function createDraftPreviewToken(
	db: D1Database,
	businessId: number,
	options: CreateDraftPreviewTokenOptions = {},
): Promise<string> {
	const token = generatePreviewToken();
	const tokenHash = await sha256Hex(token);
	const now = options.now ?? new Date();
	const ttlMs = options.ttlMs ?? DEFAULT_PREVIEW_TTL_MS;
	const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

	await db
		.prepare(`
			INSERT INTO draft_preview_tokens (business_id, token_hash, expires_at)
			VALUES (?, ?, ?)
			ON CONFLICT(business_id) DO UPDATE SET
				token_hash = excluded.token_hash,
				expires_at = excluded.expires_at,
				created_at = datetime('now')
		`)
		.bind(businessId, tokenHash, expiresAt)
		.run();

	return token;
}

export async function verifyDraftPreviewToken(
	db: D1Database,
	locSlug: string,
	bizSlug: string,
	token: string | null,
	now = new Date(),
): Promise<boolean> {
	if (!token) return false;

	const tokenHash = await sha256Hex(token);
	const row = await db
		.prepare(`
			SELECT d.expires_at
			FROM draft_preview_tokens d
			JOIN businesses b ON b.id = d.business_id
			JOIN localities l ON l.id = b.locality_id
			WHERE l.slug = ? AND b.slug = ? AND d.token_hash = ?
		`)
		.bind(locSlug, bizSlug, tokenHash)
		.first<{ expires_at: string }>();

	return !!row && row.expires_at > now.toISOString();
}

export async function invalidateDraftPreviewToken(
	db: D1Database,
	businessId: number,
): Promise<void> {
	await db
		.prepare("DELETE FROM draft_preview_tokens WHERE business_id = ?")
		.bind(businessId)
		.run();
}
