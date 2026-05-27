import { describe, expect, it } from "vitest";
import sellerRouteSource from "./[token].astro?raw";

describe("seller/admin route", () => {
	it("loads transcript evidence for the optional chat deep link on the existing route", () => {
		expect(sellerRouteSource).toContain("loadSellerPanelRouteData");
		expect(sellerRouteSource).toContain("chatEvidence={data.chatEvidence}");
		expect(sellerRouteSource).toContain("recentChats={data.recentChats}");
	});
});
