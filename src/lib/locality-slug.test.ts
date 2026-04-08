import { describe, expect, it } from "vitest";
import { assignLocalitySlugs } from "./locality-slug";

describe("assignLocalitySlugs (phase 2 — full escalation)", () => {
	it("escalates to L3 (name+gmi+pow) when name+gmi collides across powiats", () => {
		// Two villages "Dąbrowa" each in a gmina coincidentally named "Lipno",
		// but the gminas are in different powiats.
		const result = assignLocalitySlugs([
			{
				name: "Dąbrowa",
				gmi_name: "Lipno",
				pow_name: "lipnowski",
				woj_name: "kujawsko-pomorskie",
				sym: "1001",
			},
			{
				name: "Dąbrowa",
				gmi_name: "Lipno",
				pow_name: "leszczyński",
				woj_name: "wielkopolskie",
				sym: "1002",
			},
		]);
		expect(result.map((r) => r.slug)).toEqual([
			"dabrowa-lipno-lipnowski",
			"dabrowa-lipno-leszczynski",
		]);
	});

	it("handles cross-level collision: a row's L1 string equals another row's L2 string", () => {
		// Real TERYT case (Sejny):
		//   "Kolonia Sejny" in gm. Sejny → L1 slug "kolonia-sejny" (L1 unique)
		//   "Kolonia"       in gm. Sejny → would-be L2 "kolonia-sejny" — CLASH
		//   "Kolonia"       in gm. Lipno → L2 "kolonia-lipno" — fine
		// The "Kolonia" in gm. Sejny must escalate further to avoid the clash.
		const result = assignLocalitySlugs([
			{
				name: "Kolonia Sejny",
				gmi_name: "Sejny",
				pow_name: "sejneński",
				woj_name: "PODLASKIE",
				sym: "0768126",
			},
			{
				name: "Kolonia",
				gmi_name: "Sejny",
				pow_name: "sejneński",
				woj_name: "PODLASKIE",
				sym: "0768439",
			},
			{
				name: "Kolonia",
				gmi_name: "Lipno",
				pow_name: "lipnowski",
				woj_name: "kujawsko-pomorskie",
				sym: "0700001",
			},
		]);
		const slugs = result.map((r) => r.slug);
		expect(new Set(slugs).size).toBe(3);
		expect(slugs[0]).toBe("kolonia-sejny");
		expect(slugs[2]).toBe("kolonia-lipno");
		expect(slugs[1]).not.toBe("kolonia-sejny");
		expect(slugs[1]).toMatch(/^kolonia-sejny-/);
	});

	it("escalates to L4 (name+gmi+pow+woj) when name+gmi+pow collides across wojewodztwa", () => {
		// Synthetic: same name, gmi, pow across two different woj.
		const result = assignLocalitySlugs([
			{
				name: "Nowa Wieś",
				gmi_name: "Lipowa",
				pow_name: "grodzki",
				woj_name: "śląskie",
				sym: "2001",
			},
			{
				name: "Nowa Wieś",
				gmi_name: "Lipowa",
				pow_name: "grodzki",
				woj_name: "łódzkie",
				sym: "2002",
			},
		]);
		expect(result.map((r) => r.slug)).toEqual([
			"nowa-wies-lipowa-grodzki-slaskie",
			"nowa-wies-lipowa-grodzki-lodzkie",
		]);
	});

	it("falls back to `sym` suffix when even name+gmi+pow+woj collides", () => {
		// Pathological synthetic: identical TERYT path differing only by sym.
		// Real TERYT (sym_pod filtered) shouldn't produce this, but the algorithm
		// must remain defensive.
		const result = assignLocalitySlugs([
			{
				name: "Edge",
				gmi_name: "Case",
				pow_name: "test",
				woj_name: "synthetic",
				sym: "9001",
			},
			{
				name: "Edge",
				gmi_name: "Case",
				pow_name: "test",
				woj_name: "synthetic",
				sym: "9002",
			},
		]);
		expect(result.map((r) => r.slug)).toEqual([
			"edge-case-test-synthetic-9001",
			"edge-case-test-synthetic-9002",
		]);
	});

	it("does not over-escalate: each row gets the minimal level needed", () => {
		// Mix: L1 unique, L2 collision pair, L3 collision pair, all in one input.
		const result = assignLocalitySlugs([
			// L1 unique
			{
				name: "Warszawa",
				gmi_name: "Warszawa",
				pow_name: "warszawski",
				woj_name: "mazowieckie",
				sym: "0001",
			},
			// L2 pair (same name, different gmi)
			{
				name: "Brzezie",
				gmi_name: "Kłaj",
				pow_name: "wielicki",
				woj_name: "małopolskie",
				sym: "0010",
			},
			{
				name: "Brzezie",
				gmi_name: "Mosina",
				pow_name: "poznański",
				woj_name: "wielkopolskie",
				sym: "0011",
			},
			// L3 pair (same name+gmi, different pow)
			{
				name: "Dąbrowa",
				gmi_name: "Lipno",
				pow_name: "lipnowski",
				woj_name: "kujawsko-pomorskie",
				sym: "0020",
			},
			{
				name: "Dąbrowa",
				gmi_name: "Lipno",
				pow_name: "leszczyński",
				woj_name: "wielkopolskie",
				sym: "0021",
			},
		]);
		expect(result.map((r) => r.slug)).toEqual([
			"warszawa",
			"brzezie-klaj",
			"brzezie-mosina",
			"dabrowa-lipno-lipnowski",
			"dabrowa-lipno-leszczynski",
		]);
	});

	it("annotates each result with the escalation level it landed on", () => {
		const result = assignLocalitySlugs([
			{
				name: "Warszawa",
				gmi_name: "Warszawa",
				pow_name: "warszawski",
				woj_name: "mazowieckie",
				sym: "0001",
			},
			{
				name: "Brzezie",
				gmi_name: "Kłaj",
				pow_name: "wielicki",
				woj_name: "małopolskie",
				sym: "0010",
			},
			{
				name: "Brzezie",
				gmi_name: "Mosina",
				pow_name: "poznański",
				woj_name: "wielkopolskie",
				sym: "0011",
			},
			{
				name: "Dąbrowa",
				gmi_name: "Lipno",
				pow_name: "lipnowski",
				woj_name: "kujawsko-pomorskie",
				sym: "0020",
			},
			{
				name: "Dąbrowa",
				gmi_name: "Lipno",
				pow_name: "leszczyński",
				woj_name: "wielkopolskie",
				sym: "0021",
			},
			{
				name: "Nowa Wieś",
				gmi_name: "Lipowa",
				pow_name: "grodzki",
				woj_name: "śląskie",
				sym: "0030",
			},
			{
				name: "Nowa Wieś",
				gmi_name: "Lipowa",
				pow_name: "grodzki",
				woj_name: "łódzkie",
				sym: "0031",
			},
			{
				name: "Edge",
				gmi_name: "Case",
				pow_name: "test",
				woj_name: "synth",
				sym: "9001",
			},
			{
				name: "Edge",
				gmi_name: "Case",
				pow_name: "test",
				woj_name: "synth",
				sym: "9002",
			},
		]);
		expect(result.map((r) => r.level)).toEqual([
			1,
			2,
			2,
			3,
			3,
			4,
			4,
			"sym",
			"sym",
		]);
	});

	it("is deterministic: identical input produces identical output", () => {
		const input: Parameters<typeof assignLocalitySlugs>[0] = [
			{
				name: "Brzezie",
				gmi_name: "Kłaj",
				pow_name: "wielicki",
				woj_name: "małopolskie",
				sym: "0010",
			},
			{
				name: "Brzezie",
				gmi_name: "Mosina",
				pow_name: "poznański",
				woj_name: "wielkopolskie",
				sym: "0011",
			},
			{
				name: "Dąbrowa",
				gmi_name: "Lipno",
				pow_name: "lipnowski",
				woj_name: "kujawsko-pomorskie",
				sym: "0020",
			},
			{
				name: "Dąbrowa",
				gmi_name: "Lipno",
				pow_name: "leszczyński",
				woj_name: "wielkopolskie",
				sym: "0021",
			},
		];
		const a = assignLocalitySlugs(input);
		const b = assignLocalitySlugs(input);
		expect(b).toEqual(a);
	});

	it("property: synthetic full TERYT-shaped input → unique slugs == input length", () => {
		// Build a synthetic dataset that exercises every escalation level:
		//   - many unique L1 names
		//   - L2 collisions: same name, different gmi
		//   - L3 collisions: same name+gmi, different pow
		//   - L4 collisions: same name+gmi+pow, different woj
		//   - sym fallback: same name+gmi+pow+woj
		type Row = Parameters<typeof assignLocalitySlugs>[0][number];
		const input: Row[] = [];

		// 800 unique L1 rows
		for (let i = 0; i < 800; i++) {
			input.push({
				name: `Unikat${i}`,
				gmi_name: `Gmina${i}`,
				pow_name: `Powiat${i % 50}`,
				woj_name: `Woj${i % 16}`,
				sym: `1${String(i).padStart(5, "0")}`,
			});
		}
		// 100 L2 collision pairs (200 rows): same name, different gmi
		for (let i = 0; i < 100; i++) {
			input.push({
				name: `KolizjaL2_${i}`,
				gmi_name: `GminaA${i}`,
				pow_name: `PowA${i}`,
				woj_name: `Woj${i % 16}`,
				sym: `2${String(i * 2).padStart(5, "0")}`,
			});
			input.push({
				name: `KolizjaL2_${i}`,
				gmi_name: `GminaB${i}`,
				pow_name: `PowB${i}`,
				woj_name: `Woj${i % 16}`,
				sym: `2${String(i * 2 + 1).padStart(5, "0")}`,
			});
		}
		// 50 L3 collision pairs: same name+gmi, different pow
		for (let i = 0; i < 50; i++) {
			input.push({
				name: `KolizjaL3_${i}`,
				gmi_name: "Lipno",
				pow_name: `PowL3A${i}`,
				woj_name: `Woj${i % 16}`,
				sym: `3${String(i * 2).padStart(5, "0")}`,
			});
			input.push({
				name: `KolizjaL3_${i}`,
				gmi_name: "Lipno",
				pow_name: `PowL3B${i}`,
				woj_name: `Woj${i % 16}`,
				sym: `3${String(i * 2 + 1).padStart(5, "0")}`,
			});
		}
		// 20 L4 collision pairs: same name+gmi+pow, different woj
		for (let i = 0; i < 20; i++) {
			input.push({
				name: `KolizjaL4_${i}`,
				gmi_name: "Lipowa",
				pow_name: "grodzki",
				woj_name: `WojL4A${i}`,
				sym: `4${String(i * 2).padStart(5, "0")}`,
			});
			input.push({
				name: `KolizjaL4_${i}`,
				gmi_name: "Lipowa",
				pow_name: "grodzki",
				woj_name: `WojL4B${i}`,
				sym: `4${String(i * 2 + 1).padStart(5, "0")}`,
			});
		}
		// 5 sym fallback pairs: identical TERYT path, distinct sym
		for (let i = 0; i < 5; i++) {
			input.push({
				name: `EdgeSym${i}`,
				gmi_name: "X",
				pow_name: "X",
				woj_name: "X",
				sym: `9${String(i * 2).padStart(5, "0")}`,
			});
			input.push({
				name: `EdgeSym${i}`,
				gmi_name: "X",
				pow_name: "X",
				woj_name: "X",
				sym: `9${String(i * 2 + 1).padStart(5, "0")}`,
			});
		}

		const result = assignLocalitySlugs(input);
		const slugs = new Set(result.map((r) => r.slug));
		expect(slugs.size).toBe(input.length);
	});
});

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
});
