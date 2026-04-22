import { describe, expect, it } from "vitest";

/**
 * Tests the trailing-slash redirect logic from worker.ts.
 * We replicate the condition here because the full worker requires
 * the Astro SSR manifest which isn't available in unit tests.
 */
function trailingSlashRedirect(requestUrl: string): Response | null {
	const url = new URL(requestUrl);
	if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
		url.pathname = url.pathname.replace(/\/+$/, "");
		return new Response(null, {
			status: 301,
			headers: { Location: url.toString() },
		});
	}
	return null;
}

describe("worker trailing-slash redirect", () => {
	it("redirects /path/ to /path with 301", () => {
		const res = trailingSlashRedirect("https://wizytowka.link/lomianki/");
		expect(res).not.toBeNull();
		expect(res?.status).toBe(301);
		expect(res?.headers.get("Location")).toBe(
			"https://wizytowka.link/lomianki",
		);
	});

	it("redirects nested /loc/slug/ to /loc/slug", () => {
		const res = trailingSlashRedirect(
			"https://wizytowka.link/lomianki/some-business/",
		);
		expect(res).not.toBeNull();
		expect(res?.status).toBe(301);
		expect(res?.headers.get("Location")).toBe(
			"https://wizytowka.link/lomianki/some-business",
		);
	});

	it("does NOT redirect root /", () => {
		const res = trailingSlashRedirect("https://wizytowka.link/");
		expect(res).toBeNull();
	});

	it("does NOT redirect paths without trailing slash", () => {
		const res = trailingSlashRedirect("https://wizytowka.link/lomianki");
		expect(res).toBeNull();
	});

	it("strips multiple trailing slashes", () => {
		const res = trailingSlashRedirect("https://wizytowka.link/lomianki///");
		expect(res).not.toBeNull();
		expect(res?.headers.get("Location")).toBe(
			"https://wizytowka.link/lomianki",
		);
	});

	it("preserves query string", () => {
		const res = trailingSlashRedirect(
			"https://wizytowka.link/lomianki/?draft=1",
		);
		expect(res).not.toBeNull();
		expect(res?.headers.get("Location")).toBe(
			"https://wizytowka.link/lomianki?draft=1",
		);
	});
});
