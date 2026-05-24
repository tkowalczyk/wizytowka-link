// biz_ + 32 hex chars from 16 random bytes = 128 bits of entropy
export function generateOwnerToken(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return `biz_${hex}`;
}
