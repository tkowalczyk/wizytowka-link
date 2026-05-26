import { describe, expect, it, vi } from "vitest";
import {
	CHAT_INACTIVITY_TIMEOUT_MINUTES,
	classifyChatIntent,
	createZAIChatProvider,
} from "./chat";

describe("createZAIChatProvider", () => {
	it("configures Z.AI glm-5 for conservative non-streaming chat responses", async () => {
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				Response.json({
					choices: [{ message: { content: "Odpowiedź testowa" } }],
				}),
		);

		const provider = createZAIChatProvider(
			"test-zai-key",
			fetchMock as unknown as typeof fetch,
		);

		await expect(
			provider.complete([{ role: "user", content: "Test" }]),
		).resolves.toBe("Odpowiedź testowa");

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");
		expect(init?.headers).toMatchObject({
			Authorization: "Bearer test-zai-key",
			"Content-Type": "application/json",
		});

		const body = JSON.parse(init?.body as string) as {
			model: string;
			stream: boolean;
			thinking: { type: string };
			temperature: number;
			max_tokens: number;
		};
		expect(body.model).toBe("glm-5");
		expect(body.stream).toBe(false);
		expect(body.thinking).toEqual({ type: "disabled" });
		expect(body.temperature).toBeLessThanOrEqual(0.2);
		expect(body.max_tokens).toBeGreaterThan(0);
		expect(body.max_tokens).toBeLessThanOrEqual(300);
	});
});

describe("chat inactivity configuration", () => {
	it("uses an initial 30 minute inactivity timeout", () => {
		expect(CHAT_INACTIVITY_TIMEOUT_MINUTES).toBe(30);
	});
});

describe("classifyChatIntent", () => {
	it.each([
		["booking_reservation", "Chcę zarezerwować termin na jutro.", true, false],
		["quote_pricing", "Jaka jest cena naprawy i proszę o wycenę?", true, false],
		["availability", "Czy macie dostępność dzisiaj po południu?", true, false],
		["complaint", "Chcę złożyć reklamację i skargę.", false, true],
		["job_request", "Czy można wysłać CV w sprawie pracy?", true, false],
		[
			"contact_detail_request",
			"Podaj telefon albo email do firmy.",
			false,
			false,
		],
	] as const)("classifies %s transcripts distinctly", (category, visitorContent, hasCommercialDemand, hasComplaint) => {
		const result = classifyChatIntent([
			{ role: "visitor", content: visitorContent },
			{ role: "assistant", content: "Odpowiedź testowa." },
		]);

		expect(result.categories).toEqual([category]);
		expect(result.hasCommercialDemand).toBe(hasCommercialDemand);
		expect(result.hasComplaint).toBe(hasComplaint);
		expect(result.summary.length).toBeGreaterThan(0);
	});

	it("tracks complaints separately even when commercial demand is also present", () => {
		const result = classifyChatIntent([
			{
				role: "visitor",
				content: "Mam reklamację i chcę zapytać o wycenę kolejnej usługi.",
			},
		]);

		expect(result.categories).toEqual(
			expect.arrayContaining(["complaint", "quote_pricing"]),
		);
		expect(result.hasComplaint).toBe(true);
		expect(result.hasCommercialDemand).toBe(true);
	});
});
