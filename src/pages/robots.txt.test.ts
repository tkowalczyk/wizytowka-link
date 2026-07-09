import { describe, expect, it } from "vitest";
import { GET } from "./robots.txt";

// Issue #84: robots.txt had zero coverage. It gates what crawlers may reach —
// a silent regression (e.g. disallowing "/" or dropping the sitemap line) would
// deindex the whole site. Exercise the real handler end-to-end.
const invoke = () => GET({} as unknown as Parameters<typeof GET>[0]);

describe("GET robots.txt", () => {
	it("serves plain text", async () => {
		const res = await invoke();
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/plain");
	});

	it("allows the public root and disallows the private /s/ and /api/ paths", async () => {
		const body = await (await invoke()).text();
		expect(body).toMatch(/^Allow: \/$/m);
		expect(body).toMatch(/^Disallow: \/s\/$/m);
		expect(body).toMatch(/^Disallow: \/api\/$/m);
	});

	it("points crawlers at the absolute https sitemap", async () => {
		const body = await (await invoke()).text();
		expect(body).toContain("Sitemap: https://wizytowka.link/sitemap.xml");
	});
});
