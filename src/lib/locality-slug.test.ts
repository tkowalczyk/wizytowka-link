import { describe, expect, it } from "vitest";
import { assignLocalitySlugs } from "./locality-slug";

describe("assignLocalitySlugs (phase 1 — name + gmi)", () => {
	it("assigns bare slug when name is unique across the input", () => {
		const result = assignLocalitySlugs([
			{
				name: "Warszawa",
				gmi_name: "Warszawa",
				pow_name: "warszawski",
				woj_name: "mazowieckie",
				sym: "0918123",
			},
		]);
		expect(result[0].slug).toBe("warszawa");
	});

	it("appends gmina slug to BOTH sides of a 2-way collision (symmetry)", () => {
		const result = assignLocalitySlugs([
			{
				name: "Brzezie",
				gmi_name: "Kłaj",
				pow_name: "wielicki",
				woj_name: "małopolskie",
				sym: "0001",
			},
			{
				name: "Brzezie",
				gmi_name: "Mosina",
				pow_name: "poznański",
				woj_name: "wielkopolskie",
				sym: "0002",
			},
		]);
		expect(result.map((r) => r.slug)).toEqual([
			"brzezie-klaj",
			"brzezie-mosina",
		]);
	});

	it("3-way collision (2 in one gmina would be unresolvable; here 1+1+1 across 3 gminas) all get gmi suffix", () => {
		const result = assignLocalitySlugs([
			{
				name: "Dąbrówka",
				gmi_name: "Poznań",
				pow_name: "poznański",
				woj_name: "wielkopolskie",
				sym: "0010",
			},
			{
				name: "Dąbrówka",
				gmi_name: "Kraków",
				pow_name: "krakowski",
				woj_name: "małopolskie",
				sym: "0011",
			},
			{
				name: "Dąbrówka",
				gmi_name: "Lublin",
				pow_name: "lubelski",
				woj_name: "lubelskie",
				sym: "0012",
			},
		]);
		expect(result.map((r) => r.slug)).toEqual([
			"dabrowka-poznan",
			"dabrowka-krakow",
			"dabrowka-lublin",
		]);
	});

	it("does not affect non-colliding rows when others collide", () => {
		const result = assignLocalitySlugs([
			{
				name: "Brzezie",
				gmi_name: "Kłaj",
				pow_name: "wielicki",
				woj_name: "małopolskie",
				sym: "0001",
			},
			{
				name: "Brzezie",
				gmi_name: "Mosina",
				pow_name: "poznański",
				woj_name: "wielkopolskie",
				sym: "0002",
			},
			{
				name: "Warszawa",
				gmi_name: "Warszawa",
				pow_name: "warszawski",
				woj_name: "mazowieckie",
				sym: "0003",
			},
		]);
		expect(result[2].slug).toBe("warszawa");
	});

	it("throws with a readable error when two localities share name AND gmina (unresolvable at level 1)", () => {
		expect(() =>
			assignLocalitySlugs([
				{
					name: "Brzezie",
					gmi_name: "Kłaj",
					pow_name: "wielicki",
					woj_name: "małopolskie",
					sym: "0001",
				},
				{
					name: "Brzezie",
					gmi_name: "Kłaj",
					pow_name: "wielicki",
					woj_name: "małopolskie",
					sym: "0099",
				},
			]),
		).toThrow(/duplicate slug.*brzezie-klaj/i);
	});
});
