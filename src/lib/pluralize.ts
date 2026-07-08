export function pluralizeFirma(count: number): "firma" | "firmy" | "firm" {
	const mod10 = count % 10;
	const mod100 = count % 100;

	if (count === 1) return "firma";
	if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
		return "firmy";
	}
	return "firm";
}
