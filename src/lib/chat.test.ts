import { describe, expect, it, vi } from "vitest";
import { createZAIChatProvider } from "./chat";

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
