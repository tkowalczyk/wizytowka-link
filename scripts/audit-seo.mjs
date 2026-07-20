#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://wizytowka.link";
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ERRORS = 100;

const HELP = `Usage: pnpm audit:seo [options]

Audit every URL submitted in sitemap.xml for indexability and metadata.

Options:
  --base-url=<url>       Site origin (default: ${DEFAULT_BASE_URL})
  --concurrency=<1-32>   Parallel page requests (default: ${DEFAULT_CONCURRENCY})
  --timeout-ms=<number>  Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --limit=<number>       Check only the first N sitemap URLs
  --max-errors=<number>  Maximum detailed failures in output (default: ${DEFAULT_MAX_ERRORS})
  --json                 Emit one JSON result to stdout; progress goes to stderr
  --help                 Show this help

Exit codes:
  0  Audit passed
  1  SEO findings detected
  2  Invalid arguments or audit could not run
`;

function positiveInteger(
	value,
	flag,
	{ min = 1, max = Number.MAX_SAFE_INTEGER } = {},
) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(
			`${flag} must be an integer from ${min} to ${max}; received "${value}"`,
		);
	}
	return parsed;
}

export function parseArgs(argv) {
	const options = {
		baseUrl: DEFAULT_BASE_URL,
		concurrency: DEFAULT_CONCURRENCY,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		limit: null,
		maxErrors: DEFAULT_MAX_ERRORS,
		json: false,
		help: false,
	};

	for (const arg of argv) {
		if (arg === "--") continue;
		if (arg === "--json") options.json = true;
		else if (arg === "--help" || arg === "-h") options.help = true;
		else if (arg.startsWith("--base-url=")) {
			options.baseUrl = arg.slice("--base-url=".length);
		} else if (arg.startsWith("--concurrency=")) {
			options.concurrency = positiveInteger(
				arg.slice("--concurrency=".length),
				"--concurrency",
				{ max: 32 },
			);
		} else if (arg.startsWith("--timeout-ms=")) {
			options.timeoutMs = positiveInteger(
				arg.slice("--timeout-ms=".length),
				"--timeout-ms",
				{ min: 100 },
			);
		} else if (arg.startsWith("--limit=")) {
			options.limit = positiveInteger(arg.slice("--limit=".length), "--limit");
		} else if (arg.startsWith("--max-errors=")) {
			options.maxErrors = positiveInteger(
				arg.slice("--max-errors=".length),
				"--max-errors",
			);
		} else {
			throw new Error(
				`Unknown option "${arg}"; valid options: --base-url, --concurrency, --timeout-ms, --limit, --max-errors, --json, --help`,
			);
		}
	}

	let base;
	try {
		base = new URL(options.baseUrl);
	} catch {
		throw new Error(
			`--base-url must be an absolute http(s) URL; received "${options.baseUrl}"`,
		);
	}
	if (!["http:", "https:"].includes(base.protocol)) {
		throw new Error(
			`--base-url protocol must be http or https; received "${base.protocol}"`,
		);
	}
	base.hash = "";
	base.search = "";
	base.pathname = base.pathname.replace(/\/+$/, "");
	options.baseUrl = base.toString().replace(/\/$/, "");

	return options;
}

function decodeXml(value) {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'");
}

export function parseSitemapUrls(xml) {
	return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) =>
		decodeXml(match[1]),
	);
}

function tags(html, tagName) {
	return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) ?? [];
}

function attribute(tag, name) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = tag.match(
		new RegExp(`\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
	);
	return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function metaValues(html, key, value) {
	return tags(html, "meta")
		.filter((tag) => attribute(tag, key)?.toLowerCase() === value.toLowerCase())
		.map((tag) => attribute(tag, "content"));
}

function canonicalValues(html) {
	return tags(html, "link")
		.filter((tag) =>
			attribute(tag, "rel")?.toLowerCase().split(/\s+/).includes("canonical"),
		)
		.map((tag) => attribute(tag, "href"));
}

function comparableUrl(value) {
	try {
		return new URL(value).href;
	} catch {
		return null;
	}
}

function requiredSingle(issues, values, label) {
	if (values.length !== 1) {
		issues.push(`${label}: expected exactly 1, found ${values.length}`);
		return null;
	}
	if (!values[0]?.trim()) {
		issues.push(`${label}: content is empty`);
		return null;
	}
	return values[0].trim();
}

export function inspectHtml(html, pageUrl) {
	const issues = [];
	const socialImages = [];
	const htmlTags = tags(html, "html");
	if (
		htmlTags.length !== 1 ||
		attribute(htmlTags[0], "lang")?.toLowerCase() !== "pl"
	) {
		issues.push('html lang: expected exactly one <html lang="pl">');
	}

	const titleValues = [
		...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi),
	].map((match) => match[1].replace(/<[^>]+>/g, "").trim());
	const title = requiredSingle(issues, titleValues, "title");
	if (title && title.length > 70)
		issues.push(`title: ${title.length} characters (maximum 70)`);

	const descriptions = metaValues(html, "name", "description");
	const description = requiredSingle(issues, descriptions, "meta description");
	if (description && description.length > 170) {
		issues.push(
			`meta description: ${description.length} characters (maximum 170)`,
		);
	}

	const robots = requiredSingle(
		issues,
		metaValues(html, "name", "robots"),
		"meta robots",
	);
	if (robots && /\bnoindex\b/i.test(robots))
		issues.push(`meta robots: submitted URL is noindex (${robots})`);

	const canonical = requiredSingle(issues, canonicalValues(html), "canonical");
	if (canonical && comparableUrl(canonical) !== comparableUrl(pageUrl)) {
		issues.push(`canonical: expected ${pageUrl}, found ${canonical}`);
	}

	for (const property of ["og:title", "og:description", "og:url", "og:image"]) {
		const content = requiredSingle(
			issues,
			metaValues(html, "property", property),
			property,
		);
		if (
			property === "og:url" &&
			content &&
			comparableUrl(content) !== comparableUrl(pageUrl)
		) {
			issues.push(`og:url: expected ${pageUrl}, found ${content}`);
		}
		if (property === "og:image" && content) {
			if (!comparableUrl(content)?.startsWith("https://"))
				issues.push(`og:image: expected absolute https URL, found ${content}`);
			else socialImages.push(content);
		}
	}

	for (const name of [
		"twitter:card",
		"twitter:title",
		"twitter:description",
		"twitter:image",
	]) {
		const content = requiredSingle(
			issues,
			metaValues(html, "name", name),
			name,
		);
		if (name === "twitter:image" && content) {
			if (!comparableUrl(content)?.startsWith("https://"))
				issues.push(
					`twitter:image: expected absolute https URL, found ${content}`,
				);
			else socialImages.push(content);
		}
	}

	if ((html.match(/<h1\b/gi) ?? []).length !== 1) {
		issues.push(
			`h1: expected exactly 1, found ${(html.match(/<h1\b/gi) ?? []).length}`,
		);
	}

	for (const match of html.matchAll(
		/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
	)) {
		try {
			JSON.parse(match[1]);
		} catch (error) {
			issues.push(
				`JSON-LD: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
			);
		}
	}

	return { issues, socialImages };
}

async function fetchWithTimeout(url, timeoutMs, init = {}) {
	const signal = AbortSignal.timeout(timeoutMs);
	return fetch(url, {
		...init,
		signal,
		headers: { "User-Agent": "wizytowka-seo-audit/1.0", ...init.headers },
	});
}

async function inspectPage(url, timeoutMs) {
	try {
		const response = await fetchWithTimeout(url, timeoutMs, {
			redirect: "manual",
		});
		const issues = [];
		if (response.status !== 200) {
			issues.push(`HTTP: expected 200, found ${response.status}`);
			return { url, issues, socialImages: [] };
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.toLowerCase().includes("text/html")) {
			issues.push(
				`Content-Type: expected text/html, found ${contentType || "missing"}`,
			);
			return { url, issues, socialImages: [] };
		}
		const html = await response.text();
		const inspected = inspectHtml(html, url);
		return { url, ...inspected };
	} catch (error) {
		return {
			url,
			issues: [
				`Request failed: ${error instanceof Error ? error.message : String(error)}`,
			],
			socialImages: [],
		};
	}
}

async function inspectPng(url, timeoutMs) {
	try {
		const response = await fetchWithTimeout(url, timeoutMs, {
			redirect: "manual",
		});
		const issues = [];
		if (response.status !== 200)
			issues.push(`HTTP: expected 200, found ${response.status}`);
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.toLowerCase().includes("image/png"))
			issues.push(
				`Content-Type: expected image/png, found ${contentType || "missing"}`,
			);
		const bytes = new Uint8Array(await response.arrayBuffer());
		const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
		if (
			bytes.length < 24 ||
			!pngSignature.every((value, index) => bytes[index] === value)
		) {
			issues.push("Image: response is not a valid PNG header");
		} else {
			const view = new DataView(
				bytes.buffer,
				bytes.byteOffset,
				bytes.byteLength,
			);
			const width = view.getUint32(16);
			const height = view.getUint32(20);
			if (width !== 1200 || height !== 630)
				issues.push(
					`Image dimensions: expected 1200x630, found ${width}x${height}`,
				);
		}
		return { url, issues };
	} catch (error) {
		return {
			url,
			issues: [
				`Request failed: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
}

async function concurrentMap(items, concurrency, mapper, onProgress) {
	const results = new Array(items.length);
	let nextIndex = 0;
	let completed = 0;
	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		async () => {
			while (true) {
				const index = nextIndex++;
				if (index >= items.length) return;
				results[index] = await mapper(items[index], index);
				completed++;
				onProgress(completed, items.length);
			}
		},
	);
	await Promise.all(workers);
	return results;
}

export async function runAudit(options) {
	const startedAt = Date.now();
	const sitemapUrl = `${options.baseUrl}/sitemap.xml`;
	const robotsUrl = `${options.baseUrl}/robots.txt`;
	const infrastructureFailures = [];

	const [robotsResponse, sitemapResponse] = await Promise.all([
		fetchWithTimeout(robotsUrl, options.timeoutMs, { redirect: "manual" }),
		fetchWithTimeout(sitemapUrl, options.timeoutMs, { redirect: "manual" }),
	]);
	const robots = await robotsResponse.text();
	if (robotsResponse.status !== 200)
		infrastructureFailures.push({
			url: robotsUrl,
			issues: [`HTTP: expected 200, found ${robotsResponse.status}`],
		});
	for (const directive of [
		"Allow: /",
		"Disallow: /api/",
		"Disallow: /s/",
		`Sitemap: ${sitemapUrl}`,
	]) {
		if (!robots.split(/\r?\n/).includes(directive))
			infrastructureFailures.push({
				url: robotsUrl,
				issues: [`robots.txt: missing exact directive "${directive}"`],
			});
	}

	if (sitemapResponse.status !== 200) {
		throw new Error(
			`Cannot audit sitemap: ${sitemapUrl} returned ${sitemapResponse.status}`,
		);
	}
	const sitemapContentType = sitemapResponse.headers.get("content-type") ?? "";
	if (!sitemapContentType.toLowerCase().includes("xml"))
		infrastructureFailures.push({
			url: sitemapUrl,
			issues: [
				`Content-Type: expected XML, found ${sitemapContentType || "missing"}`,
			],
		});
	const xml = await sitemapResponse.text();
	const discovered = parseSitemapUrls(xml);
	if (discovered.length === 0)
		throw new Error(
			`Cannot audit sitemap: ${sitemapUrl} contains no <loc> URLs`,
		);
	if (discovered.length > 50_000)
		infrastructureFailures.push({
			url: sitemapUrl,
			issues: [`Sitemap URL count: ${discovered.length} exceeds 50000`],
		});
	const duplicateCount = discovered.length - new Set(discovered).size;
	if (duplicateCount > 0)
		infrastructureFailures.push({
			url: sitemapUrl,
			issues: [`Sitemap contains ${duplicateCount} duplicate URLs`],
		});

	const baseOrigin = new URL(options.baseUrl).origin;
	for (const url of discovered) {
		let parsed;
		try {
			parsed = new URL(url);
		} catch {
			infrastructureFailures.push({
				url: sitemapUrl,
				issues: [`Invalid absolute URL in sitemap: ${url}`],
			});
			continue;
		}
		if (parsed.origin !== baseOrigin)
			infrastructureFailures.push({
				url: sitemapUrl,
				issues: [`Cross-origin URL in sitemap: ${url}`],
			});
		if (
			parsed.pathname.startsWith("/api/") ||
			parsed.pathname.startsWith("/s/")
		)
			infrastructureFailures.push({
				url: sitemapUrl,
				issues: [`Private URL in sitemap: ${url}`],
			});
	}

	const urls = options.limit ? discovered.slice(0, options.limit) : discovered;
	let lastHeartbeat = Date.now();
	const pageResults = await concurrentMap(
		urls,
		options.concurrency,
		(url) => inspectPage(url, options.timeoutMs),
		(completed, total) => {
			const now = Date.now();
			if (
				completed === total ||
				completed % 100 === 0 ||
				now - lastHeartbeat >= 30_000
			) {
				console.error(`SEO audit progress: ${completed}/${total} URLs checked`);
				lastHeartbeat = now;
			}
		},
	);

	const socialImages = [
		...new Set(pageResults.flatMap((result) => result.socialImages)),
	];
	const assetResults = await concurrentMap(
		socialImages,
		Math.min(options.concurrency, 4),
		(url) => inspectPng(url, options.timeoutMs),
		() => {},
	);
	const allFailures = [
		...infrastructureFailures,
		...pageResults
			.filter((result) => result.issues.length > 0)
			.map(({ url, issues }) => ({ url, issues })),
		...assetResults.filter((result) => result.issues.length > 0),
	];

	return {
		ok: allFailures.length === 0,
		base_url: options.baseUrl,
		sitemap_url: sitemapUrl,
		urls_discovered: discovered.length,
		urls_checked: urls.length,
		assets_checked: assetResults.length,
		failures_count: allFailures.length,
		failures: allFailures.slice(0, options.maxErrors),
		failures_truncated: Math.max(0, allFailures.length - options.maxErrors),
		duration_ms: Date.now() - startedAt,
	};
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(
			`SEO audit argument error: ${error instanceof Error ? error.message : String(error)}`,
		);
		console.error("Run with --help to see valid options.");
		process.exitCode = 2;
		return;
	}
	if (options.help) {
		console.log(HELP);
		return;
	}

	try {
		const result = await runAudit(options);
		if (options.json) console.log(JSON.stringify(result));
		else {
			console.log(
				`SEO audit ${result.ok ? "PASS" : "FAIL"}: ${result.urls_checked}/${result.urls_discovered} sitemap URLs checked, ${result.assets_checked} social assets checked, ${result.failures_count} failures, ${result.duration_ms}ms`,
			);
			for (const failure of result.failures) {
				console.log(`\n${failure.url}`);
				for (const issue of failure.issues) console.log(`  - ${issue}`);
			}
			if (result.failures_truncated > 0)
				console.log(
					`\n${result.failures_truncated} additional failures omitted; raise --max-errors to display them.`,
				);
		}
		if (!result.ok) process.exitCode = 1;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options?.json)
			console.log(JSON.stringify({ ok: false, error: message }));
		else console.error(`SEO audit could not run: ${message}`);
		process.exitCode = 2;
	}
}

if (
	typeof process !== "undefined" &&
	process.argv[1]?.endsWith("audit-seo.mjs")
) {
	await main();
}
