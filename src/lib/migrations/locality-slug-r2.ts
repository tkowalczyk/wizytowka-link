export type R2OpAction = "copy";

export interface R2Op {
	action: R2OpAction;
	from: string;
	to: string;
}

export interface PlanR2Input {
	liveKeys: readonly string[];
	draftKeys: readonly string[];
	slugMap: ReadonlyMap<string, string>;
}

const LIVE_RE = /^sites\/([^/]+)\/([^/]+\.json)$/;
const DRAFT_RE = /^sites\/draft\/([^/]+)\/([^/]+\.json)$/;

function planForKeys(
	keys: readonly string[],
	re: RegExp,
	prefix: string,
	slugMap: ReadonlyMap<string, string>,
): R2Op[] {
	const ops: R2Op[] = [];
	for (const key of keys) {
		const m = re.exec(key);
		if (!m) continue;
		const [, oldLoc, file] = m;
		const newLoc = slugMap.get(oldLoc);
		if (!newLoc || newLoc === oldLoc) continue;
		ops.push({
			action: "copy",
			from: key,
			to: `${prefix}${newLoc}/${file}`,
		});
	}
	return ops;
}

export function planR2Rename(input: PlanR2Input): R2Op[] {
	return [
		...planForKeys(input.liveKeys, LIVE_RE, "sites/", input.slugMap),
		...planForKeys(input.draftKeys, DRAFT_RE, "sites/draft/", input.slugMap),
	];
}

export async function listAllKeys(
	r2: R2Bucket,
	prefix: string,
): Promise<string[]> {
	const out: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await r2.list({ prefix, cursor, limit: 1000 });
		for (const obj of page.objects) out.push(obj.key);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out;
}

export interface ApplyR2Result {
	copied: number;
	deleted: number;
	skipped: number;
}

export async function applyR2Rename(
	r2: R2Bucket,
	ops: readonly R2Op[],
): Promise<ApplyR2Result> {
	let copied = 0;
	let deleted = 0;
	let skipped = 0;
	for (const op of ops) {
		// Idempotency: if target already exists, skip the copy step but still
		// delete the source so the migration converges.
		const targetExists = (await r2.head(op.to)) !== null;
		if (!targetExists) {
			const src = await r2.get(op.from);
			if (!src) {
				// Source vanished mid-flight (already migrated by a parallel run).
				skipped++;
				continue;
			}
			await r2.put(op.to, src.body, {
				httpMetadata: src.httpMetadata,
			});
			copied++;
		} else {
			skipped++;
		}
		await r2.delete(op.from);
		deleted++;
	}
	return { copied, deleted, skipped };
}
