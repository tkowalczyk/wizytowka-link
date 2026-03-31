export async function findOwnerByChatId(
  db: D1Database, chatId: string,
): Promise<{ business_id: number } | null> {
  return db.prepare(
    'SELECT business_id FROM business_owners WHERE chat_id = ?',
  ).bind(chatId).first<{ business_id: number }>();
}

export async function getBusinessSlugs(
  db: D1Database, bizId: number,
): Promise<{ bizSlug: string; locSlug: string } | null> {
  const biz = await db.prepare(
    'SELECT slug, locality_id FROM businesses WHERE id = ?',
  ).bind(bizId).first<{ slug: string; locality_id: number }>();
  if (!biz) return null;

  const loc = await db.prepare(
    'SELECT slug FROM localities WHERE id = ?',
  ).bind(biz.locality_id).first<{ slug: string }>();
  if (!loc) return null;

  return { bizSlug: biz.slug, locSlug: loc.slug };
}
