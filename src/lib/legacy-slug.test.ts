import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import {
	extractLegacyLocalitySlug,
	goneResponse,
	isLegacyLocalityPath,
} from "./legacy-slug";

describe("extractLegacyLocalitySlug", () => {
	it("matches locality-only path with 7-digit sym", () => {
		expect(extractLegacyLocalitySlug("/jozefow-0987897")).toBe(
			"jozefow-0987897",
		);
	});

	it("matches locality+business path", () => {
		expect(
			extractLegacyLocalitySlug("/jozefow-0723566/bar-sajgon-z-gwiazdka"),
		).toBe("jozefow-0723566");
	});

	it("matches multi-word locality with sym (Bielsko-Biała case)", () => {
		expect(extractLegacyLocalitySlug("/bielsko-biala-1234567")).toBe(
			"bielsko-biala-1234567",
		);
	});

	it("rejects path without sym suffix", () => {
		expect(extractLegacyLocalitySlug("/radzymin")).toBeNull();
		expect(extractLegacyLocalitySlug("/radzymin/kwiatomat")).toBeNull();
	});

	it("rejects sym with wrong digit count", () => {
		expect(extractLegacyLocalitySlug("/jozefow-123456")).toBeNull();
		expect(extractLegacyLocalitySlug("/jozefow-12345678")).toBeNull();
	});

	it("rejects 3+ segment paths (cannot be legacy form)", () => {
		expect(extractLegacyLocalitySlug("/api/leads/foo-1234567")).toBeNull();
		expect(extractLegacyLocalitySlug("/jozefow-0723566/biz/extra")).toBeNull();
	});

	it("rejects root and unrelated static paths", () => {
		expect(extractLegacyLocalitySlug("/")).toBeNull();
		expect(extractLegacyLocalitySlug("/regulamin")).toBeNull();
		expect(extractLegacyLocalitySlug("/sitemap.xml")).toBeNull();
	});
});

describe("isLegacyLocalityPath", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	it("returns true for sym-suffixed slug missing from D1", async () => {
		// 0918123 (Warszawa's sym) exists, but its current slug is 'warszawa',
		// not 'warszawa-0918123' — so the legacy form is gone.
		expect(await isLegacyLocalityPath(env.leadgen, "/warszawa-0918123")).toBe(
			true,
		);
	});

	it("returns true for legacy form with business path", async () => {
		expect(
			await isLegacyLocalityPath(
				env.leadgen,
				"/warszawa-0918123/hydraulik-warszawa",
			),
		).toBe(true);
	});

	it("returns false when slug exists in D1 (current sym-fallback NEW slug)", async () => {
		// Inject a locality whose current slug happens to match the sym shape.
		await env.leadgen
			.prepare("INSERT INTO localities (name, slug, sym) VALUES (?, ?, ?)")
			.bind("Test", "test-name-gmi-pow-woj-9999999", "9999999")
			.run();
		expect(
			await isLegacyLocalityPath(env.leadgen, "/test-name-gmi-pow-woj-9999999"),
		).toBe(false);
	});

	it("returns false for non-matching paths (regular 404 territory)", async () => {
		expect(await isLegacyLocalityPath(env.leadgen, "/radzymin")).toBe(false);
		expect(await isLegacyLocalityPath(env.leadgen, "/radzymin/kwiatomat")).toBe(
			false,
		);
	});
});

describe("goneResponse", () => {
	it("returns 410 with HTML body and noindex meta", async () => {
		const res = goneResponse();
		expect(res.status).toBe(410);
		expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
		const body = await res.text();
		expect(body).toMatch(/noindex/);
		expect(body).toMatch(/Strona usunięta/);
	});
});
