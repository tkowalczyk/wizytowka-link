import { describe, expect, it } from "vitest";
import { formatOperatingHours } from "./operating-hours";

describe("formatOperatingHours", () => {
	it("converts a scraped JSON blob into a Polish display string", () => {
		const raw = JSON.stringify({
			monday: "9 AM to 5 PM",
			tuesday: "9 AM to 5 PM",
		});

		const { display } = formatOperatingHours(raw);

		expect(display).not.toMatch(/^\{/);
		expect(display).toContain("poniedziałek");
		expect(display).toContain("09:00");
		expect(display).toContain("17:00");
	});

	it("collapses consecutive identical days in week order and marks closed days", () => {
		const raw = JSON.stringify({
			// deliberately out of week order to prove canonical sorting
			sunday: "Closed",
			saturday: "10 AM to 2 PM",
			friday: "9 AM to 5 PM",
			monday: "9 AM to 5 PM",
			tuesday: "9 AM to 5 PM",
			wednesday: "9 AM to 5 PM",
			thursday: "9 AM to 5 PM",
		});

		const { display } = formatOperatingHours(raw);

		expect(display).toBe(
			"poniedziałek–piątek 09:00–17:00, sobota 10:00–14:00, niedziela nieczynne",
		);
	});

	it("emits schema.org openingHours entries with closed days omitted", () => {
		const raw = JSON.stringify({
			monday: "9 AM to 5 PM",
			tuesday: "9 AM to 5 PM",
			wednesday: "9 AM to 5 PM",
			thursday: "9 AM to 5 PM",
			friday: "9 AM to 5 PM",
			saturday: "10 AM to 2 PM",
			sunday: "Closed",
		});

		const { schema } = formatOperatingHours(raw);

		expect(schema).toEqual(["Mo-Fr 09:00-17:00", "Sa 10:00-14:00"]);
		for (const entry of schema) {
			expect(entry).toMatch(
				/^[A-Z][a-z](-[A-Z][a-z])? \d{2}:\d{2}-\d{2}:\d{2}$/,
			);
		}
	});

	it("renders round-the-clock days instead of dropping them", () => {
		const raw = JSON.stringify({
			monday: "Open 24 hours",
			tuesday: "Open 24 hours",
		});

		const { display, schema } = formatOperatingHours(raw);

		expect(display).toBe("poniedziałek–wtorek całodobowo");
		expect(schema).toEqual(["Mo-Tu 00:00-23:59"]);
	});

	it("passes legacy human-readable strings through unchanged as display", () => {
		const { display, schema } = formatOperatingHours("Pon-Pt 09:00-17:00");

		expect(display).toBe("Pon-Pt 09:00-17:00");
		expect(schema).toEqual([]);
	});

	it("returns no hours for null or empty input", () => {
		expect(formatOperatingHours(null)).toEqual({ display: null, schema: [] });
		expect(formatOperatingHours(undefined)).toEqual({
			display: null,
			schema: [],
		});
		expect(formatOperatingHours("")).toEqual({ display: null, schema: [] });
	});

	it("degrades to no display rather than printing an unparseable JSON blob", () => {
		const raw = JSON.stringify({
			monday: "whenever we feel like it",
			tuesday: "¯\\_(ツ)_/¯",
		});

		const { display, schema } = formatOperatingHours(raw);

		expect(display).toBeNull();
		expect(schema).toEqual([]);
	});
});
