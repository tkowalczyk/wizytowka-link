import { describe, expect, it } from "vitest";
import { inspectHtml, parseArgs, parseSitemapUrls } from "./audit-seo.mjs";

const completeHtml = `<!doctype html>
<html lang="pl"><head>
<title>Testowa firma</title>
<meta name="description" content="Opis firmy">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://wizytowka.link/test/firma">
<meta property="og:title" content="Testowa firma">
<meta property="og:description" content="Opis firmy">
<meta property="og:url" content="https://wizytowka.link/test/firma">
<meta property="og:image" content="https://wizytowka.link/og-default.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Testowa firma">
<meta name="twitter:description" content="Opis firmy">
<meta name="twitter:image" content="https://wizytowka.link/og-default.png">
<script type="application/ld+json">{"@context":"https://schema.org"}</script>
</head><body><h1>Testowa firma</h1></body></html>`;

describe("SEO audit CLI arguments", () => {
	it("is non-interactive and has bounded defaults", () => {
		expect(parseArgs([])).toMatchObject({
			baseUrl: "https://wizytowka.link",
			concurrency: 8,
			timeoutMs: 15_000,
			maxErrors: 100,
			json: false,
		});
	});

	it("accepts the conventional pnpm argument separator", () => {
		expect(parseArgs(["--", "--limit=5"]).limit).toBe(5);
	});

	it("rejects unknown options and enumerates the valid set", () => {
		expect(() => parseArgs(["--wat"])).toThrow(/valid options:/);
	});

	it("bounds concurrency to avoid accidental crawler floods", () => {
		expect(() => parseArgs(["--concurrency=33"])).toThrow(/1 to 32/);
	});
});

describe("parseSitemapUrls", () => {
	it("extracts and XML-decodes sitemap locations", () => {
		expect(
			parseSitemapUrls(
				"<urlset><url><loc>https://example.test/a&amp;b</loc></url></urlset>",
			),
		).toEqual(["https://example.test/a&b"]);
	});
});

describe("inspectHtml", () => {
	it("accepts one complete, indexable metadata set", () => {
		expect(
			inspectHtml(completeHtml, "https://wizytowka.link/test/firma"),
		).toEqual({
			issues: [],
			socialImages: [
				"https://wizytowka.link/og-default.png",
				"https://wizytowka.link/og-default.png",
			],
		});
	});

	it("enumerates duplicate canonical and submitted noindex failures", () => {
		const invalid = completeHtml
			.replace('content="index, follow"', 'content="noindex, follow"')
			.replace(
				'<link rel="canonical" href="https://wizytowka.link/test/firma">',
				'<link rel="canonical" href="https://wizytowka.link/test/firma"><link rel="canonical" href="https://wizytowka.link/test/firma">',
			);
		const result = inspectHtml(invalid, "https://wizytowka.link/test/firma");

		expect(result.issues).toContain(
			"meta robots: submitted URL is noindex (noindex, follow)",
		);
		expect(result.issues).toContain("canonical: expected exactly 1, found 2");
	});
});
