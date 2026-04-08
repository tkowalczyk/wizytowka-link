export interface LocalityLabelInput {
	name: string;
	gmi_name: string;
	pow_name: string;
}

/**
 * Canonical full label for a locality, used in the business page header.
 * Format is identical regardless of how many parts the slug algorithm
 * needed to disambiguate. Single source of truth for UI.
 */
export function formatLocalityLabel(loc: LocalityLabelInput): string {
	return `${loc.name}, gm. ${loc.gmi_name}, pow. ${loc.pow_name}`;
}
