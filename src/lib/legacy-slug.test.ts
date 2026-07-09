import { describe, expect, it } from "vitest";
import { goneResponse } from "./legacy-slug";

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
