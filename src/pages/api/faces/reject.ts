import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { appDb } from "@/db";
import { db } from "@/config/db";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";

/** POST { faceIds } – "Stranger" for single faces: mark suggestions as rejected (hidden from future lists; logged; Immich is not touched). */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const faceIds: string[] = Array.isArray(req.body?.faceIds) ? req.body.faceIds.slice(0, 500) : [];
  const logIds: number[] = [];
  for (const faceId of faceIds) {
    const s = ((await appDb.all(sql`SELECT assetId, suggestedPersonId, distance FROM face_suggestion WHERE faceId = ${faceId} AND ownerId = ${user.id}`)) as any[])[0];
    if (!s) {
      // Face without a stored suggestion (e.g. shown in the group detail view): store a placeholder row so it
      // stays out of group actions.
      const r = await db.execute(sql`SELECT f."assetId", f."personId" FROM asset_face f WHERE f.id = ${faceId}::uuid`);
      const f = ((r as any).rows ?? r)[0];
      if (!f) continue;
      const now = new Date().toISOString();
      await appDb.run(sql`INSERT OR IGNORE INTO face_suggestion (faceId, assetId, ownerId, suggestedPersonId, distance, currentPersonId, status, scannedAt)
        VALUES (${faceId}, ${f.assetId}, ${user.id}, '', 99, ${f.personId ?? null}, 'rejected', ${now})`);
      const ins = (await appDb.all(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, assetId, ok) VALUES (${now}, ${user.id}, ${user.name ?? null}, 'reject', ${faceId}, ${f.assetId}, 1) RETURNING id`)) as any[];
      if (ins[0]?.id) logIds.push(ins[0].id);
      continue;
    }
    await appDb.run(sql`UPDATE face_suggestion SET status = 'rejected' WHERE faceId = ${faceId}`);
    const ins = (await appDb.all(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, assetId, toPersonId, distance, ok)
      VALUES (${new Date().toISOString()}, ${user.id}, ${user.name ?? null}, 'reject', ${faceId}, ${s.assetId}, ${s.suggestedPersonId}, ${s.distance}, 1) RETURNING id`)) as any[];
    if (ins[0]?.id) logIds.push(ins[0].id);
  }
  return res.status(200).json({ ok: true, logIds });
}
