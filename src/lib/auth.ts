// crypto.subtle.timingSafeEqual is a Cloudflare Workers extension not present
// in the DOM SubtleCrypto lib types — cast locally to expose it.
type WorkersSubtleCrypto = SubtleCrypto & {
	timingSafeEqual(
		a: ArrayBuffer | ArrayBufferView,
		b: ArrayBuffer | ArrayBufferView,
	): boolean;
};

export async function timingSafeCompare(
	provided: string | null | undefined,
	expected: string,
): Promise<boolean> {
	if (!provided) return false;
	const enc = new TextEncoder();
	const subtle = crypto.subtle as WorkersSubtleCrypto;
	const providedHash = await subtle.digest("SHA-256", enc.encode(provided));
	const expectedHash = await subtle.digest("SHA-256", enc.encode(expected));
	return subtle.timingSafeEqual(providedHash, expectedHash);
}
