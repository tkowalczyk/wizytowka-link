import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteContent } from "../types/site";
import type { LLMProvider } from "./site-content";
import {
	createGLM5,
	editContent,
	generateContent,
	summarizeChanges,
	validateContent,
} from "./site-content";

const VALID_JSON = JSON.stringify({
	hero: { headline: "Witamy", subheadline: "Sub" },
	about: { title: "O nas", text: "Tekst" },
	services: [{ name: "S1", description: "D1" }],
	contact: { cta_text: "Zadzwoń", phone: "123", address: "ul. X" },
	seo: { title: "Tytuł", description: "Opis" },
});

describe("validateContent", () => {
	it("parses valid JSON into SiteContent", () => {
		const result = validateContent(VALID_JSON);
		expect(result.hero.headline).toBe("Witamy");
		expect(result.services).toHaveLength(1);
		expect(result).not.toHaveProperty("theme");
	});

	it("strips markdown fences", () => {
		const wrapped = `\`\`\`json\n${VALID_JSON}\n\`\`\``;
		const result = validateContent(wrapped);
		expect(result.hero.headline).toBe("Witamy");
	});

	it("truncates SEO title >60 chars", () => {
		const data = JSON.parse(VALID_JSON);
		data.seo.title = "A".repeat(80);
		const result = validateContent(JSON.stringify(data));
		expect(result.seo.title).toHaveLength(60);
	});

	it("truncates SEO description >155 chars", () => {
		const data = JSON.parse(VALID_JSON);
		data.seo.description = "B".repeat(200);
		const result = validateContent(JSON.stringify(data));
		expect(result.seo.description).toHaveLength(155);
	});

	it("throws on missing hero", () => {
		const data = JSON.parse(VALID_JSON);
		delete data.hero;
		expect(() => validateContent(JSON.stringify(data))).toThrow("invalid hero");
	});

	it("throws on empty services", () => {
		const data = JSON.parse(VALID_JSON);
		data.services = [];
		expect(() => validateContent(JSON.stringify(data))).toThrow(
			"invalid services",
		);
	});

	it("throws on malformed JSON", () => {
		expect(() => validateContent("not json at all")).toThrow();
	});
});

function fakeLLM(response: string): LLMProvider {
	return { complete: async () => response };
}

describe("generateContent", () => {
	it("returns valid SiteContent without theme", async () => {
		const llm = fakeLLM(VALID_JSON);
		const result = await generateContent(llm, {
			title: "Test Firma",
			category: "restauracja",
			address: "ul. Testowa 1",
			phone: "123456789",
			rating: 4.5,
		});
		expect(result.hero.headline).toBe("Witamy");
		expect(result.contact.phone).toBe("123");
		expect(result).not.toHaveProperty("theme");
	});
});

const CURRENT: SiteContent = {
	hero: { headline: "Witamy", subheadline: "Sub" },
	about: { title: "O nas", text: "Tekst" },
	services: [{ name: "S1", description: "D1" }],
	contact: { cta_text: "Zadzwoń", phone: "999888777", address: "ul. X" },
	seo: { title: "Tytuł", description: "Opis" },
};

describe("editContent", () => {
	it("preserves original phone even if LLM changes it", async () => {
		const edited = {
			...CURRENT,
			hero: { headline: "Nowy", subheadline: "Sub" },
		};
		(edited as Record<string, unknown>).contact = {
			cta_text: "Zadzwoń",
			phone: "HACKED",
			address: "ul. X",
		};
		const llm = fakeLLM(JSON.stringify(edited));
		const result = await editContent(llm, CURRENT, "zmień nagłówek");
		expect(result.contact.phone).toBe("999888777");
		expect(result.hero.headline).toBe("Nowy");
	});
});

describe("summarizeChanges", () => {
	it("reports headline change", () => {
		const updated: SiteContent = {
			...CURRENT,
			hero: { headline: "Nowy", subheadline: "Sub" },
		};
		expect(summarizeChanges(CURRENT, updated)).toContain("Nowy");
	});

	it("reports added and removed services", () => {
		const updated: SiteContent = {
			...CURRENT,
			services: [{ name: "S2", description: "D2" }],
		};
		const summary = summarizeChanges(CURRENT, updated);
		expect(summary).toContain("S2");
		expect(summary).toContain("S1");
	});

	it("returns no-change message when identical", () => {
		expect(summarizeChanges(CURRENT, CURRENT)).toBe("Brak widocznych zmian");
	});
});

describe("createGLM5 error handling", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it("caps large upstream error body so thrown Error stays bounded", async () => {
		const huge = "X".repeat(1_000_000); // 1 MB simulated HTML 502 page
		globalThis.fetch = vi.fn(
			async () =>
				new Response(huge, { status: 502, statusText: "Bad Gateway" }),
		) as unknown as typeof fetch;

		const llm = createGLM5("test-key");
		let caught: unknown;
		try {
			await llm.complete([{ role: "user", content: "hi" }]);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(Error);
		const msg = (caught as Error).message;
		expect(msg).toContain("502");
		// Preserves at least the first ~500 chars of the upstream body
		expect(msg).toMatch(/X{500,}/);
		// Total message length is bounded — well below the 1 MB upstream payload
		expect(msg.length).toBeLessThan(5000);
	});
});
