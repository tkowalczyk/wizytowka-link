import type { SiteContent } from "../types/site";

export interface LLMProvider {
	complete(
		messages: { role: "system" | "user"; content: string }[],
	): Promise<string>;
}

export interface BusinessInput {
	title: string;
	category: string;
	address: string;
	phone: string;
	rating: number | null;
}

interface GLMResponse {
	choices: { message: { content: string } }[];
}

export function createGLM5(apiKey: string): LLMProvider {
	return {
		async complete(messages) {
			const res = await fetch(
				"https://api.z.ai/api/coding/paas/v4/chat/completions",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify({
						model: "glm-5",
						messages,
						temperature: 0.7,
						max_tokens: 6000,
					}),
				},
			);
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`GLM-5 ${res.status}: ${text}`);
			}
			const data = (await res.json()) as GLMResponse;
			return data.choices[0].message.content;
		},
	};
}

const SYSTEM_PROMPT = `Jestes ekspertem od marketingu lokalnych firm w Polsce. Generujesz tresc strony wizytowkowej w formacie JSON.`;

function buildUserPrompt(biz: BusinessInput): string {
	return `Wygeneruj JSON strony wizytowkowej dla firmy:
- Nazwa: ${biz.title}
- Kategoria: ${biz.category}
- Adres: ${biz.address}
- Telefon: ${biz.phone}
- Ocena Google: ${biz.rating != null ? `${biz.rating}/5` : "brak"}

Format JSON:
{
  "hero": { "headline": "...", "subheadline": "..." },
  "about": { "title": "...", "text": "..." },
  "services": [{ "name": "...", "description": "..." }],
  "contact": { "cta_text": "...", "phone": "...", "address": "..." },
  "seo": { "title": "...", "description": "..." }
}

Zasady:
- Pisz po polsku, naturalnie, bez marketingowego bullshitu
- 3-5 uslug dopasowanych do kategorii
- SEO title max 60 znakow, description max 155
- Odpowiedz TYLKO JSON, bez markdown`;
}

export async function generateContent(
	llm: LLMProvider,
	biz: BusinessInput,
): Promise<SiteContent> {
	const raw = await llm.complete([
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: buildUserPrompt(biz) },
	]);
	return validateContent(raw);
}

const EDIT_SYSTEM_PROMPT = `Jestes asystentem edycji wizytowek firmowych.
Otrzymujesz obecny JSON wizytowki i instrukcje od wlasciciela firmy.
Zwroc CALY zaktualizowany JSON z naniesionymi zmianami.
Odpowiedz TYLKO JSON, bez markdown, bez komentarzy.

Dozwolone edycje:
- Dodawanie/edycja/usuwanie uslug (services)
- Zmiana godzin pracy (w about.text lub contact)
- Zmiana adresu (contact.address)
- Edycja opisu firmy (about.text, hero)

NIE WOLNO zmieniac:
- Numeru telefonu (contact.phone)

Jesli instrukcja jest niejasna, zrob najlepsza interpretacje.
Jesli instrukcja jest poza dozwolonym zakresem, zwroc oryginalny JSON bez zmian.`;

export async function editContent(
	llm: LLMProvider,
	current: SiteContent,
	instruction: string,
): Promise<SiteContent> {
	const raw = await llm.complete([
		{ role: "system", content: EDIT_SYSTEM_PROMPT },
		{
			role: "user",
			content: `Obecna wizytowka:\n${JSON.stringify(current, null, 2)}\n\nInstrukcja: ${instruction}`,
		},
	]);
	const patched = validateContent(raw);
	patched.contact.phone = current.contact.phone;
	return patched;
}

export function summarizeChanges(
	old: SiteContent,
	updated: SiteContent,
): string {
	const changes: string[] = [];

	if (old.hero.headline !== updated.hero.headline)
		changes.push(`Naglowek: "${updated.hero.headline}"`);
	if (old.about.text !== updated.about.text)
		changes.push("Opis firmy: zmieniony");
	if (old.contact.address !== updated.contact.address)
		changes.push(`Adres: "${updated.contact.address}"`);

	const oldNames = old.services.map((s) => s.name);
	const newNames = updated.services.map((s) => s.name);
	const added = newNames.filter((n) => !oldNames.includes(n));
	const removed = oldNames.filter((n) => !newNames.includes(n));
	if (added.length) changes.push(`Nowe uslugi: ${added.join(", ")}`);
	if (removed.length) changes.push(`Usuniete uslugi: ${removed.join(", ")}`);

	return changes.length ? changes.join("\n") : "Brak widocznych zmian";
}

function isStr(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

export function validateContent(raw: string): SiteContent {
	const cleaned = raw
		.replace(/^```json?\n?/, "")
		.replace(/\n?```$/, "")
		.trim();
	const p = JSON.parse(cleaned) as Record<string, unknown>;

	if (typeof p !== "object" || p === null) throw new Error("not an object");

	const hero = p.hero as Record<string, unknown> | undefined;
	if (!hero || !isStr(hero.headline) || !isStr(hero.subheadline))
		throw new Error("invalid hero");

	const about = p.about as Record<string, unknown> | undefined;
	if (!about || !isStr(about.title) || !isStr(about.text))
		throw new Error("invalid about");

	const services = p.services;
	if (!Array.isArray(services) || services.length < 1)
		throw new Error("invalid services");
	for (const s of services as Record<string, unknown>[]) {
		if (!isStr(s.name) || !isStr(s.description))
			throw new Error("invalid service item");
	}

	const contact = p.contact as Record<string, unknown> | undefined;
	if (!contact || !isStr(contact.cta_text) || !isStr(contact.phone))
		throw new Error("invalid contact");
	if (!isStr(contact.address)) contact.address = "";

	const seo = p.seo as Record<string, unknown> | undefined;
	if (!seo || !isStr(seo.title) || !isStr(seo.description))
		throw new Error("invalid seo");
	if ((seo.title as string).length > 60)
		seo.title = (seo.title as string).slice(0, 60);
	if ((seo.description as string).length > 155)
		seo.description = (seo.description as string).slice(0, 155);

	return {
		hero: hero as unknown as SiteContent["hero"],
		about: about as unknown as SiteContent["about"],
		services: services as unknown as SiteContent["services"],
		contact: contact as unknown as SiteContent["contact"],
		seo: seo as unknown as SiteContent["seo"],
	};
}
