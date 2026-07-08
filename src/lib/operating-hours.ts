export interface FormattedOperatingHours {
	/** Human-readable Polish display string, or null when there is nothing to show. */
	display: string | null;
	/** schema.org `openingHours` entries like "Mo-Fr 09:00-17:00"; empty when unparseable. */
	schema: string[];
}

// Canonical week order. `pl` is the public-page label, `abbr` the schema.org
// two-letter day code (Mo, Tu, …). Order matters: consecutive days with
// identical hours are collapsed into a range.
const WEEK: ReadonlyArray<{ key: string; pl: string; abbr: string }> = [
	{ key: "monday", pl: "poniedziałek", abbr: "Mo" },
	{ key: "tuesday", pl: "wtorek", abbr: "Tu" },
	{ key: "wednesday", pl: "środa", abbr: "We" },
	{ key: "thursday", pl: "czwartek", abbr: "Th" },
	{ key: "friday", pl: "piątek", abbr: "Fr" },
	{ key: "saturday", pl: "sobota", abbr: "Sa" },
	{ key: "sunday", pl: "niedziela", abbr: "Su" },
];

const CLOSED = "nieczynne";

// Parse "9 AM to 5 PM" / "9:30 AM–5 PM" style time tokens into 24h "HH:MM".
function parseTime(token: string): string | null {
	const match = token.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
	if (!match) return null;
	let hour = Number(match[1]);
	const minute = match[2] ? Number(match[2]) : 0;
	const meridiem = match[3].toUpperCase();
	if (hour < 1 || hour > 12 || minute > 59) return null;
	if (meridiem === "AM") hour = hour === 12 ? 0 : hour;
	else hour = hour === 12 ? 12 : hour + 12;
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// A day's hours resolved into its public-page label and, when applicable, a
// schema.org time range (null for closed days, which schema.org can't express).
interface DayValue {
	display: string;
	schema: string | null;
}

// Normalize a single day's raw hours string, or return null when the text can't
// be understood (that day is then skipped rather than printed verbatim).
function normalizeDay(hours: string): DayValue | null {
	if (/closed|zamkni|nieczynne/i.test(hours)) {
		return { display: CLOSED, schema: null };
	}
	if (/24\s*hours|całą\s*dobę|całodobow/i.test(hours)) {
		return { display: "całodobowo", schema: "00:00-23:59" };
	}
	const normalized = hours.replace(/\s+to\s+/i, "–").replace(/[-—]/g, "–");
	const [rawStart, rawEnd] = normalized.split("–");
	if (!rawStart || !rawEnd) return null;
	const start = parseTime(rawStart);
	const end = parseTime(rawEnd);
	if (!start || !end) return null;
	return { display: `${start}–${end}`, schema: `${start}-${end}` };
}

export function formatOperatingHours(
	raw: string | null | undefined,
): FormattedOperatingHours {
	if (!raw) return { display: null, schema: [] };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { display: raw, schema: [] };
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { display: raw, schema: [] };
	}

	const source = parsed as Record<string, unknown>;
	const byDay = new Map<string, DayValue>();
	for (const day of WEEK) {
		const value = source[day.key];
		if (typeof value !== "string") continue;
		const normalized = normalizeDay(value);
		if (normalized) byDay.set(day.key, normalized);
	}

	// Collapse consecutive days sharing the same schedule into groups, then
	// render the display string and schema.org array from the same groups.
	const display: string[] = [];
	const schema: string[] = [];
	for (let i = 0; i < WEEK.length; ) {
		const value = byDay.get(WEEK[i].key);
		if (value === undefined) {
			i++;
			continue;
		}
		let j = i;
		while (
			j + 1 < WEEK.length &&
			byDay.get(WEEK[j + 1].key)?.display === value.display
		) {
			j++;
		}

		const plRange = i === j ? WEEK[i].pl : `${WEEK[i].pl}–${WEEK[j].pl}`;
		display.push(`${plRange} ${value.display}`);

		if (value.schema) {
			const abbrRange =
				i === j ? WEEK[i].abbr : `${WEEK[i].abbr}-${WEEK[j].abbr}`;
			schema.push(`${abbrRange} ${value.schema}`);
		}
		i = j + 1;
	}

	return { display: display.length ? display.join(", ") : null, schema };
}
