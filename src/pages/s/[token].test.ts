import { describe, expect, it } from "vitest";
import sellerRouteSource from "./[token].astro?raw";

describe("seller/admin route", () => {
	it("loads transcript evidence for the optional chat deep link on the existing route", () => {
		expect(sellerRouteSource).toContain("loadSellerPanelRouteData");
		expect(sellerRouteSource).toContain("chatEvidence={data.chatEvidence}");
		expect(sellerRouteSource).toContain("recentChats={data.recentChats}");
	});

	it("marks token-authenticated seller panel responses private and uncacheable", () => {
		expect(sellerRouteSource).toMatch(
			/Astro\.response\.headers\.set\(\s*["']Cache-Control["'],\s*["']private, no-store["']\s*\)/,
		);
	});
});
