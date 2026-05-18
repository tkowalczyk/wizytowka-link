import type { SiteData } from "../../../types/site";
import {
	createDraftPreviewToken,
	invalidateDraftPreviewToken,
} from "../../draft-preview";
import { deleteSite, getSite, promoteDraft, putSite } from "../../site-store";
import { escapeHtml } from "../../telegram";
import type { TgContext, TgHandler } from "../types";

export const startLinkHandler: TgHandler = {
	match: (update) => {
		const text = update.message?.text?.trim();
		if (!text?.startsWith("/start")) return false;
		const arg = text.split(" ")[1];
		return !!arg?.startsWith("biz_");
	},

	handle: async (ctx) => {
		const text = ctx.update.message?.text?.trim();
		if (!text) return;
		const bizToken = text.split(" ")[1];

		const owner = await ctx.env.leadgen
			.prepare(
				"SELECT id, business_id, chat_id FROM business_owners WHERE token = ?",
			)
			.bind(bizToken)
			.first<{ id: number; business_id: number; chat_id: string | null }>();

		if (!owner) {
			await ctx.reply("Nieprawidlowy token.");
			return;
		}

		if (owner.chat_id && owner.chat_id === ctx.chatId) {
			await ctx.reply(
				"Juz jestes polaczony. Wyslij wiadomosc aby edytowac wizytowke.",
			);
			return;
		}

		await ctx.env.leadgen
			.prepare("UPDATE business_owners SET chat_id = ? WHERE token = ?")
			.bind(ctx.chatId, bizToken)
			.run();

		const biz = await ctx.env.leadgen
			.prepare("SELECT title FROM businesses WHERE id = ?")
			.bind(owner.business_id)
			.first<{ title: string }>();

		await ctx.reply(
			`Polaczono z wizytowka: <b>${escapeHtml(biz?.title ?? "")}</b>\n\n` +
				"Wyslij wiadomosc aby edytowac, np.:\n" +
				'- "dodaj usluge: tapicerowanie"\n' +
				'- "zmien godziny otwarcia na 8-16"\n' +
				'- "zmien adres na ul. Nowa 5"',
		);
	},
};

export const draftCallbackHandler: TgHandler = {
	match: (update) => !!update.callback_query?.data?.match(/^(approve|reject):/),

	handle: async (ctx) => {
		const cb = ctx.update.callback_query;
		if (!cb) return;
		const data = cb.data ?? "";
		const [action, bizIdStr] = data.split(":");
		const bizId = parseInt(bizIdStr, 10);

		const owner = await ctx.env.leadgen
			.prepare("SELECT business_id FROM business_owners WHERE chat_id = ?")
			.bind(ctx.chatId)
			.first<{ business_id: number }>();

		if (!owner || owner.business_id !== bizId) {
			await ctx.reply("Brak dostepu.");
			return;
		}

		const biz = await ctx.env.leadgen
			.prepare("SELECT slug, locality_id FROM businesses WHERE id = ?")
			.bind(bizId)
			.first<{ slug: string; locality_id: number }>();
		const loc = await ctx.env.leadgen
			.prepare("SELECT slug FROM localities WHERE id = ?")
			.bind(biz?.locality_id)
			.first<{ slug: string }>();

		if (!biz || !loc) {
			await ctx.reply("Brak wizytowki.");
			return;
		}

		if (action === "approve") {
			const ok = await promoteDraft(ctx.env.sites, loc.slug, biz.slug);
			if (!ok) {
				await ctx.reply("Draft wygasl.");
				return;
			}
			await invalidateDraftPreviewToken(ctx.env.leadgen, bizId);
			await ctx.reply("Wizytowka zaktualizowana!");
		}

		if (action === "reject") {
			await deleteSite(ctx.env.sites, "draft", loc.slug, biz.slug);
			await invalidateDraftPreviewToken(ctx.env.leadgen, bizId);
			await ctx.reply("Zmiany odrzucone. Wyslij nowa instrukcje.");
		}
	},
};

export interface EditDeps {
	editContent: (current: SiteData, instruction: string) => Promise<SiteData>;
	summarizeChanges: (old: SiteData, updated: SiteData) => string;
}

async function defaultEditDeps(apiKey: string): Promise<EditDeps> {
	const { createGLM5, editContent, summarizeChanges } = await import(
		"../../site-content"
	);
	const llm = createGLM5(apiKey);
	return {
		editContent: (current, instruction) =>
			editContent(llm, current, instruction) as Promise<SiteData>,
		summarizeChanges: summarizeChanges as (
			old: SiteData,
			updated: SiteData,
		) => string,
	};
}

function createOwnerEditHandle(deps?: EditDeps) {
	return async (ctx: TgContext): Promise<void> => {
		const text = ctx.update.message?.text?.trim();
		if (!text) return;

		const owner = await ctx.env.leadgen
			.prepare("SELECT business_id FROM business_owners WHERE chat_id = ?")
			.bind(ctx.chatId)
			.first<{ business_id: number }>();

		if (!owner) return;

		const biz = await ctx.env.leadgen
			.prepare("SELECT slug, locality_id FROM businesses WHERE id = ?")
			.bind(owner.business_id)
			.first<{ slug: string; locality_id: number }>();
		const loc = await ctx.env.leadgen
			.prepare("SELECT slug FROM localities WHERE id = ?")
			.bind(biz?.locality_id)
			.first<{ slug: string }>();

		if (!biz || !loc) return;

		const currentSite = await getSite(
			ctx.env.sites,
			"live",
			loc.slug,
			biz.slug,
		);
		if (!currentSite) {
			await ctx.reply("Wizytowka jeszcze nie zostala wygenerowana.");
			return;
		}

		try {
			const d = deps ?? (await defaultEditDeps(ctx.env.ZAI_API_KEY));

			await ctx.typing();
			const patched = await d.editContent(currentSite as SiteData, text);
			const patchedSiteData = { ...currentSite, ...patched };

			await putSite(
				ctx.env.sites,
				"draft",
				loc.slug,
				biz.slug,
				patchedSiteData as SiteData,
			);

			const previewToken = await createDraftPreviewToken(
				ctx.env.leadgen,
				owner.business_id,
			);
			const previewUrl = `https://wizytowka.link/${loc.slug}/${biz.slug}?draft=1&preview_token=${encodeURIComponent(previewToken)}`;
			const summary = d.summarizeChanges(currentSite as SiteData, patched);

			await ctx.replyWithKeyboard(
				`<b>Proponowane zmiany:</b>\n\n${escapeHtml(summary)}\n\n` +
					`<a href="${previewUrl}">Podglad wizytowki</a>`,
				[
					[
						{
							text: "Zatwierdz",
							callback_data: `approve:${owner.business_id}`,
						},
						{ text: "Odrzuc", callback_data: `reject:${owner.business_id}` },
					],
				],
			);
		} catch (err) {
			const msg = (err as Error).message;
			if (msg.startsWith("GLM-5")) {
				await ctx.reply("Blad serwera. Sprobuj za chwile.");
			} else {
				await ctx.reply("Nie udalo sie przetworzyc zmian. Sprobuj ponownie.");
			}
		}
	};
}

export const ownerEditHandler: TgHandler & {
	withDeps?: (deps: EditDeps) => TgHandler;
} = {
	match: (update) =>
		!!update.message?.text && !update.message.text.startsWith("/"),
	handle: createOwnerEditHandle(),
	withDeps: (deps: EditDeps) => ({
		match: ownerEditHandler.match,
		handle: createOwnerEditHandle(deps),
	}),
};
