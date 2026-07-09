import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import { resolveStaleLocalityUrl } from "./slug-redirect";

async function insertLocality(
	slug: string,
	sym: string,
	name = "Test",
): Promise<number> {
	const row = await env.leadgen
		.prepare(
			"INSERT INTO localities (name, slug, sym) VALUES (?, ?, ?) RETURNING id",
		)
		.bind(name, slug, sym)
		.first<{ id: number }>();
	if (!row) throw new Error("failed to insert locality");
	return row.id;
}

async function insertBusiness(
	localityId: number,
	slug: string,
	siteStatus: string,
): Promise<void> {
	await env.leadgen
		.prepare(
			"INSERT INTO businesses (locality_id, place_id, title, slug, address, category, gps_lat, gps_lng, site_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.bind(
			localityId,
			`place_${slug}_${localityId}`,
			slug,
			slug,
			"ul. Testowa 1",
			"test",
			52.0,
			21.0,
			siteStatus,
		)
		.run();
}

describe("resolveStaleLocalityUrl", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	it("redirects a legacy sym-suffixed business URL to the current locality slug", async () => {
		const id = await insertLocality("zielonka-zielonka", "0921970", "Zielonka");
		await insertBusiness(id, "auto-salon-krzysztof-luniewski", "done");

		const result = await resolveStaleLocalityUrl(
			env.leadgen,
			"/zielonka-0921970/auto-salon-krzysztof-luniewski",
		);

		expect(result).toEqual({
			kind: "redirect",
			location: "/zielonka-zielonka/auto-salon-krzysztof-luniewski",
		});
	});

	it("returns gone when the sym resolves but the business is missing", async () => {
		await insertLocality("zielonka-zielonka", "0921970", "Zielonka");

		const result = await resolveStaleLocalityUrl(
			env.leadgen,
			"/zielonka-0921970/auto-salon-krzysztof-luniewski",
		);

		expect(result).toEqual({ kind: "gone" });
	});

	it("returns gone when the sym resolves but the business is not done", async () => {
		const id = await insertLocality("zielonka-zielonka", "0921970", "Zielonka");
		await insertBusiness(id, "auto-salon-krzysztof-luniewski", "pending");

		const result = await resolveStaleLocalityUrl(
			env.leadgen,
			"/zielonka-0921970/auto-salon-krzysztof-luniewski",
		);

		expect(result).toEqual({ kind: "gone" });
	});

	it("redirects a bare base-name business URL to the escalated locality slug", async () => {
		const id = await insertLocality("radzymin-radzymin", "0921111", "Radzymin");
		await insertBusiness(id, "elektryk-krzysztof-gawinski", "done");

		const result = await resolveStaleLocalityUrl(
			env.leadgen,
			"/radzymin/elektryk-krzysztof-gawinski",
		);

		expect(result).toEqual({
			kind: "redirect",
			location: "/radzymin-radzymin/elektryk-krzysztof-gawinski",
		});
	});

	it("redirects the reported ruszowice business URL to its glogow slug", async () => {
		const id = await insertLocality("ruszowice-glogow", "0922222", "Ruszowice");
		await insertBusiness(id, "autoserwis", "done");

		const result = await resolveStaleLocalityUrl(
			env.leadgen,
			"/ruszowice/autoserwis",
		);

		expect(result).toEqual({
			kind: "redirect",
			location: "/ruszowice-glogow/autoserwis",
		});
	});

	it("redirects deterministically from a history row even when two same-name localities exist (#83)", async () => {
		// Both Radzymin localities own a done business at the same slug, so the
		// base-name heuristic is ambiguous (→ gone). A history row pins the old
		// bare slug 'radzymin' to the specific locality it was published under.
		const pinned = await insertLocality(
			"radzymin-radzymin",
			"1421052",
			"Radzymin",
		);
		const other = await insertLocality(
			"radzymin-wolomin",
			"1421999",
			"Radzymin",
		);
		await insertBusiness(pinned, "elektryk-krzysztof-gawinski", "done");
		await insertBusiness(other, "elektryk-krzysztof-gawinski", "done");
		await env.leadgen
			.prepare(
				"INSERT INTO locality_slug_history (old_slug, locality_id) VALUES (?, ?)",
			)
			.bind("radzymin", pinned)
			.run();

		const result = await resolveStaleLocalityUrl(
			env.leadgen,
			"/radzymin/elektryk-krzysztof-gawinski",
		);

		expect(result).toEqual({
			kind: "redirect",
			location: "/radzymin-radzymin/elektryk-krzysztof-gawinski",
		});
	});

	it("redirects a bare locality index from a history row to the current slug (#83)", async () => {
		const pinned = await insertLocality(
			"radzymin-radzymin",
			"1421052",
			"Radzymin",
		);
		await insertLocality("radzymin-wolomin", "1421999", "Radzymin");
		await env.leadgen
			.prepare(
				"INSERT INTO locality_slug_history (old_slug, locality_id) VALUES (?, ?)",
			)
			.bind("radzymin", pinned)
			.run();

		expect(await resolveStaleLocalityUrl(env.leadgen, "/radzymin")).toEqual({
			kind: "redirect",
			location: "/radzymin-radzymin",
		});
	});

	it("returns gone when two localities share the base name and business slug", async () => {
		const a = await insertLocality("biala-x", "0923001", "Biała");
		const b = await insertLocality("biala-y", "0923002", "Biała");
		await insertBusiness(a, "sklep-abc", "done");
		await insertBusiness(b, "sklep-abc", "done");

		const result = await resolveStaleLocalityUrl(
			env.leadgen,
			"/biala/sklep-abc",
		);

		expect(result).toEqual({ kind: "gone" });
	});

	it("passes current locality and business URLs unchanged", async () => {
		expect(await resolveStaleLocalityUrl(env.leadgen, "/warszawa")).toEqual({
			kind: "pass",
		});
		expect(
			await resolveStaleLocalityUrl(
				env.leadgen,
				"/warszawa/hydraulik-warszawa",
			),
		).toEqual({ kind: "pass" });
	});

	it("passes a current slug even when an escalated sibling shares its base", async () => {
		// 'krakow' is a live slug (seed id 1); a 'krakow-*' sibling must not make
		// the exact match look like a stale base name.
		await insertLocality("krakow-nowa-huta", "0950999", "Kraków");

		expect(await resolveStaleLocalityUrl(env.leadgen, "/krakow")).toEqual({
			kind: "pass",
		});
		expect(
			await resolveStaleLocalityUrl(env.leadgen, "/krakow/dentysta-krakow"),
		).toEqual({ kind: "pass" });
	});

	it("redirects a bare locality-index URL when exactly one escalated slug matches", async () => {
		await insertLocality("ruszowice-glogow", "0922222", "Ruszowice");

		expect(await resolveStaleLocalityUrl(env.leadgen, "/ruszowice")).toEqual({
			kind: "redirect",
			location: "/ruszowice-glogow",
		});
	});

	it("returns gone for a bare locality index that maps to several localities", async () => {
		await insertLocality("radzymin-radzymin", "0921111", "Radzymin");
		await insertLocality("radzymin-wolomin", "0921112", "Radzymin");

		expect(await resolveStaleLocalityUrl(env.leadgen, "/radzymin")).toEqual({
			kind: "gone",
		});
	});

	it("passes an unknown single segment so static pages and 404s survive", async () => {
		expect(await resolveStaleLocalityUrl(env.leadgen, "/regulamin")).toEqual({
			kind: "pass",
		});
		expect(await resolveStaleLocalityUrl(env.leadgen, "/robots.txt")).toEqual({
			kind: "pass",
		});
	});

	it("redirects a legacy sym-suffixed locality index to the current slug", async () => {
		// Seed 'warszawa' has sym 0918123; its legacy slug was 'warszawa-0918123'.
		expect(
			await resolveStaleLocalityUrl(env.leadgen, "/warszawa-0918123"),
		).toEqual({ kind: "redirect", location: "/warszawa" });
	});

	it("returns gone for a sym-suffixed slug whose sym matches no locality", async () => {
		expect(
			await resolveStaleLocalityUrl(env.leadgen, "/foobar-9999999"),
		).toEqual({ kind: "gone" });
	});
});
