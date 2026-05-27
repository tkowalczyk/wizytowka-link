import { describe, expect, it } from "vitest";
import sellerPanelSource from "./SellerPanel.astro?raw";

describe("SellerPanel chat evidence view", () => {
	it("renders transcript metadata and chronological visitor/assistant messages", () => {
		expect(sellerPanelSource).toContain("chatEvidence");
		expect(sellerPanelSource).toContain("data-chat-evidence");
		expect(sellerPanelSource).toContain("chatEvidence.messages.map");
		expect(sellerPanelSource).toContain("Strona");
		expect(sellerPanelSource).toContain("Rozpoczęto");
		expect(sellerPanelSource).toContain("Zakończono");
		expect(sellerPanelSource).toContain("Referrer");
		expect(sellerPanelSource).toContain("User agent");
		expect(sellerPanelSource).toContain("Powód zakończenia");
		expect(sellerPanelSource).toContain("Wiadomości");
		expect(sellerPanelSource).toContain("Podsumowanie intencji");
		expect(sellerPanelSource).toContain("Gość");
		expect(sellerPanelSource).toContain("Asystent");
		expect(sellerPanelSource).toContain("chatEvidence.metrics");
		expect(sellerPanelSource).toContain("Wizyty strony");
		expect(sellerPanelSource).toContain("Starty chatu");
		expect(sellerPanelSource).toContain("Chat start rate");
		expect(sellerPanelSource).toContain("Wszystkie chaty");
		expect(sellerPanelSource).toContain("Suma wiadomości");
		expect(sellerPanelSource).toContain("Intencje szczegółowe");
		expect(sellerPanelSource).toContain("Powtarzający się popyt");
		expect(sellerPanelSource).toContain("Reklamacje");
		expect(sellerPanelSource).toContain("recentChats");
		expect(sellerPanelSource).toContain("data-recent-chats");
		expect(sellerPanelSource).toContain("Ostatnie chaty");
		expect(sellerPanelSource).toMatch(/\?chat=\$\{chat\.id\}/);
		expect(sellerPanelSource).toContain("Brak zapisanych chatów.");
	});
});
