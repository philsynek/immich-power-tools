import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";

/**
 * POST { faceIds, include?: boolean } – throw faces out of a group action (or take them back with include=true).
 * Tool-only: Immich is not touched. Excluded faces are skipped by "Assign whole group" and show up in single-face mode.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const faceIds: string[] = Array.isArray(req.body?.faceIds) ? req.body.faceIds.slice(0, 500) : [];
  const include = !!req.body?.include;
  const now = new Date().toISOString();
  for (const faceId of faceIds) {
    const s = ((await appDb.all(sql`SELECT assetId, status FROM face_suggestion WHERE faceId = ${faceId} AND ownerId = ${user.id}`)) as any[])[0];
    if (include) {
      if (s?.status !== "excluded") continue;
      await appDb.run(sql`UPDATE face_suggestion SET status = 'open' WHERE faceId = ${faceId}`);
    } else if (s) {
      if (s.status !== "open") continue;
      await appDb.run(sql`UPDATE face_suggestion SET status = 'excluded' WHERE faceId = ${faceId}`);
    } else {
      // Face without stored suggestion (distance above the limit): placeholder row so the group action skips it.
      const r = await db.execute(sql`SELECT "assetId", "personId" FROM asset_face WHERE id = ${faceId}::uuid`);
      const f = ((r as any).rows ?? r)[0];
      if (!f) continue;
      await appDb.run(sql`INSERT OR IGNORE INTO face_suggestion (faceId, assetId, ownerId, suggestedPersonId, distance, currentPersonId, status, scannedAt)
        VALUES (${faceId}, ${f.assetId}, ${user.id}, '', 99, ${f.personId ?? null}, 'excluded', ${now})`);
    }
    await appDb.run(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, assetId, ok)
      VALUES (${now}, ${user.id}, ${user.name ?? null}, ${include ? "include" : "exclude"}, ${faceId}, ${s?.assetId ?? null}, 1)`);
  }
  return res.status(200).json({ ok: true });
}
