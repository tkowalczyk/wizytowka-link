import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../../../../test/seed";
import { startChatSession } from "../../../lib/chat";
import { deleteSite, putSite } from "../../../lib/site-store";
import type { SiteData } from "../../../types/site";
import { POST } from "./messages";

interface ChatMessageResponse {
	message: {
		role: "assistant";
		content: string;
		createdAt: string;
	};
}

function chatMessageRequest(body: Record<string, unknown>): Request {
	return new Request("https://wizytowka.link/api/chat/messages", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function activeSessionId() {
	const result = await startChatSession(
		env.leadgen,
		{ locSlug: "warszawa", businessSlug: "hydraulik-warszawa" },
		{
			referrer: "https://example.test/source",
			userAgent: "Vitest Agent",
			startedAt: "2026-05-26T10:00:00.000Z",
		},
	);
	if (!result) throw new Error("failed to create test chat session");
	return result.sessionId;
}

function mockZaiFetch(answer: string) {
	return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const url = input.toString();
		if (url === "https://api.z.ai/api/coding/paas/v4/chat/completions") {
			return Response.json({ choices: [{ message: { content: answer } }] });
		}
		throw new Error(`Unexpected fetch: ${url}`);
	});
}

function mockZaiFetchSequence(answers: string[]) {
	let index = 0;
	return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const url = input.toString();
		if (url === "https://api.z.ai/api/coding/paas/v4/chat/completions") {
			const answer = answers[index] ?? answers.at(-1) ?? "";
			index += 1;
			return Response.json({ choices: [{ message: { content: answer } }] });
		}
		throw new Error(`Unexpected fetch: ${url}`);
	});
}

function zaiRequestBody(fetchMock: ReturnType<typeof mockZaiFetch>, call = 0) {
	return JSON.parse(fetchMock.mock.calls[call][1]?.body as string) as {
		messages: { role: string; content: string }[];
	};
}

const sampleSite: SiteData = {
	hero: {
		headline: "Hydraulik Warszawa",
		subheadline: "Szybka pomoc hydrauliczna",
	},
	about: {
		title: "O firmie",
		text: "Lokalna firma hydrauliczna. Kontakt: kontakt@hydraulik.example i https://hydraulik.example/kontakt",
	},
	services: [
		{ name: "Naprawa awarii", description: "Usuwanie przecieków" },
		{ name: "Montaż baterii", description: "Instalacje łazienkowe" },
	],
	contact: {
		cta_text: "Zadzwoń",
		phone: "+48 123 456 789",
		address: "ul. Marszałkowska 1, Warszawa",
	},
	seo: {
		title: "Hydraulik Warszawa",
		description: "Pomoc hydrauliczna w Warszawie",
	},
};

describe("POST /api/chat/messages", () => {
	let originalFetch: typeof fetch;

	beforeEach(async () => {
		await resetDb(env.leadgen);
		await deleteSite(env.sites, "live", "warszawa", "hydraulik-warszawa");
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	// Assumptions for issue #45:
	// Request body is { sessionId, content } for the current active chat session.
	// A successful response stores exactly one visitor row and one assistant row.
	// Unknown sessions return 404; ended sessions return 409 and do not store messages.
	it("stores a visitor message and assistant response for an active session", async () => {
		globalThis.fetch = mockZaiFetch(
			"Adres tego miejsca to ul. Marszałkowska 1, Warszawa.",
		) as unknown as typeof fetch;
		const sessionId = await activeSessionId();

		const response = await POST({
			request: chatMessageRequest({
				sessionId,
				content: "Jaki jest adres?",
			}),
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		const body = (await response.json()) as ChatMessageResponse;
		expect(body.message).toEqual({
			role: "assistant",
			content: "Adres tego miejsca to ul. Marszałkowska 1, Warszawa.",
			createdAt: expect.any(String),
		});

		const rows = await env.leadgen
			.prepare(
				`SELECT session_id, locality_slug, business_slug, role, content, message_index, created_at
         FROM chat_messages
         WHERE session_id = ?
         ORDER BY message_index`,
			)
			.bind(sessionId)
			.all<{
				session_id: string;
				locality_slug: string;
				business_slug: string;
				role: "visitor" | "assistant";
				content: string;
				message_index: number;
				created_at: string;
			}>();

		expect(rows.results).toEqual([
			{
				session_id: sessionId,
				locality_slug: "warszawa",
				business_slug: "hydraulik-warszawa",
				role: "visitor",
				content: "Jaki jest adres?",
				message_index: 1,
				created_at: expect.any(String),
			},
			{
				session_id: sessionId,
				locality_slug: "warszawa",
				business_slug: "hydraulik-warszawa",
				role: "assistant",
				content: "Adres tego miejsca to ul. Marszałkowska 1, Warszawa.",
				message_index: 2,
				created_at: body.message.createdAt,
			},
		]);

		const joined = await env.leadgen
			.prepare(
				`SELECT m.locality_slug, m.business_slug, m.created_at, s.referrer, s.user_agent
         FROM chat_messages m
         JOIN chat_sessions s ON s.id = m.session_id
         WHERE m.session_id = ?
         ORDER BY m.message_index`,
			)
			.bind(sessionId)
			.all<{
				locality_slug: string;
				business_slug: string;
				created_at: string;
				referrer: string | null;
				user_agent: string | null;
			}>();
		expect(joined.results).toEqual([
			{
				locality_slug: "warszawa",
				business_slug: "hydraulik-warszawa",
				created_at: expect.any(String),
				referrer: "https://example.test/source",
				user_agent: "Vitest Agent",
			},
			{
				locality_slug: "warszawa",
				business_slug: "hydraulik-warszawa",
				created_at: expect.any(String),
				referrer: "https://example.test/source",
				user_agent: "Vitest Agent",
			},
		]);
	});

	it("rejects unknown and ended sessions", async () => {
		globalThis.fetch = mockZaiFetch(
			"Nie powinno byc wywolane.",
		) as unknown as typeof fetch;
		const unknownResponse = await POST({
			request: chatMessageRequest({
				sessionId: "missing-session",
				content: "Halo?",
			}),
		} as Parameters<typeof POST>[0]);
		expect(unknownResponse.status).toBe(404);

		const sessionId = await activeSessionId();
		await env.leadgen
			.prepare("UPDATE chat_sessions SET status = 'ended' WHERE id = ?")
			.bind(sessionId)
			.run();

		const endedResponse = await POST({
			request: chatMessageRequest({
				sessionId,
				content: "Halo?",
			}),
		} as Parameters<typeof POST>[0]);
		expect(endedResponse.status).toBe(409);

		const count = await env.leadgen
			.prepare("SELECT COUNT(*) AS count FROM chat_messages")
			.first<{ count: number }>();
		expect(count?.count).toBe(0);
	});

	it("sends redacted page and business context to the LLM", async () => {
		await env.leadgen
			.prepare(
				`UPDATE businesses
         SET website = 'https://hydraulik.example',
             description = 'Opis z mailem kontakt@hydraulik.example i telefonem +48123456789',
             operating_hours = 'Pon-Pt 09:00-17:00'
         WHERE slug = 'hydraulik-warszawa'`,
			)
			.run();
		await putSite(
			env.sites,
			"live",
			"warszawa",
			"hydraulik-warszawa",
			sampleSite,
		);
		const fetchMock = mockZaiFetch("Adres to ul. Marszałkowska 1.");
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const sessionId = await activeSessionId();

		await POST({
			request: chatMessageRequest({
				sessionId,
				content: "Jaki jest adres?",
			}),
		} as Parameters<typeof POST>[0]);

		const requestText = JSON.stringify(zaiRequestBody(fetchMock));
		expect(requestText).toContain("ul. Marszałkowska 1");
		expect(requestText).not.toContain("+48123456789");
		expect(requestText).not.toContain("+48 123 456 789");
		expect(requestText).not.toContain("kontakt@hydraulik.example");
		expect(requestText).not.toContain("https://hydraulik.example");
		expect(requestText).not.toContain("https://example.test/source");
	});

	it("preserves previous turns in a two-message visitor conversation", async () => {
		const fetchMock = mockZaiFetchSequence([
			"Adres to ul. Marszałkowska 1.",
			"Wcześniej pytałeś o adres.",
		]);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const sessionId = await activeSessionId();

		await POST({
			request: chatMessageRequest({
				sessionId,
				content: "Jaki jest adres?",
			}),
		} as Parameters<typeof POST>[0]);
		const secondResponse = await POST({
			request: chatMessageRequest({
				sessionId,
				content: "O co pytałem wcześniej?",
			}),
		} as Parameters<typeof POST>[0]);

		expect(secondResponse.status).toBe(200);
		const secondBody = (await secondResponse.json()) as ChatMessageResponse;
		expect(secondBody.message.content).toBe("Wcześniej pytałeś o adres.");

		const messages = zaiRequestBody(fetchMock, 1).messages;
		expect(messages).toEqual(
			expect.arrayContaining([
				{ role: "user", content: "Jaki jest adres?" },
				{ role: "assistant", content: "Adres to ul. Marszałkowska 1." },
				{ role: "user", content: "O co pytałem wcześniej?" },
			]),
		);
	});

	it("returns an unknown-answer response instead of an ungrounded provider guess", async () => {
		const fetchMock = mockZaiFetch("Właścicielem jest Jan Kowalski.");
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const sessionId = await activeSessionId();

		const response = await POST({
			request: chatMessageRequest({
				sessionId,
				content: "Kto jest właścicielem firmy?",
			}),
		} as Parameters<typeof POST>[0]);

		const body = (await response.json()) as ChatMessageResponse;
		expect(body.message.content.toLowerCase()).toContain("nie wiem");
		expect(body.message.content).not.toContain("Jan Kowalski");
	});

	it("keeps the visitor message and stores a generic Polish fallback when the provider fails", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("provider timeout");
		}) as unknown as typeof fetch;
		const sessionId = await activeSessionId();

		const response = await POST({
			request: chatMessageRequest({
				sessionId,
				content: "Jaki jest adres?",
			}),
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		const body = (await response.json()) as ChatMessageResponse;
		expect(body.message.content).toContain("Nie mogę teraz odpowiedzieć");
		expect(body.message.content).not.toContain("ul. Marszałkowska");

		const rows = await env.leadgen
			.prepare(
				"SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY message_index",
			)
			.bind(sessionId)
			.all<{ role: string; content: string }>();
		expect(rows.results).toEqual([
			{ role: "visitor", content: "Jaki jest adres?" },
			{ role: "assistant", content: body.message.content },
		]);
	});

	it("suppresses direct contact details while allowing address and opening hours context", async () => {
		await env.leadgen
			.prepare(
				"UPDATE businesses SET website = 'https://hydraulik.example', operating_hours = 'Pon-Pt 09:00-17:00' WHERE slug = 'hydraulik-warszawa'",
			)
			.run();
		const fetchMock = mockZaiFetch(
			"Telefon to +48123456789, email kontakt@hydraulik.example, strona https://hydraulik.example.",
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const sessionId = await activeSessionId();

		const response = await POST({
			request: chatMessageRequest({
				sessionId,
				content: "Podaj telefon, email i stronę kontaktową.",
			}),
		} as Parameters<typeof POST>[0]);

		const body = (await response.json()) as ChatMessageResponse;
		expect(body.message.content).toContain("wymaga kontaktu z człowiekiem");
		expect(body.message.content).toContain("ul. Marszałkowska 1");
		expect(body.message.content).toContain("Pon-Pt 09:00-17:00");
		expect(body.message.content).not.toContain("+48123456789");
		expect(body.message.content).not.toContain("kontakt@hydraulik.example");
		expect(body.message.content).not.toContain("https://hydraulik.example");
	});

	it.each([
		"Chcę zarezerwować termin na jutro.",
		"Jaka jest cena naprawy?",
		"Czy macie dostępność dziś?",
		"Chcę złożyć reklamację.",
		"Czy mogę wysłać CV w sprawie pracy?",
	])("guides actionable request to a human channel: %s", async (content) => {
		const fetchMock = mockZaiFetch(
			"Zarezerwowałem termin i potwierdzam cenę 100 zł.",
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const sessionId = await activeSessionId();

		const response = await POST({
			request: chatMessageRequest({ sessionId, content }),
		} as Parameters<typeof POST>[0]);

		const body = (await response.json()) as ChatMessageResponse;
		expect(body.message.content).toContain("wymaga kontaktu z człowiekiem");
		expect(body.message.content).not.toContain("Zarezerwowałem");
		expect(body.message.content).not.toContain("100 zł");
	});
});
