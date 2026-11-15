import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { appDb } from "@/db";
import { db } from "@/config/db";
import { ENV } from "@/config/environment";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { getUserHeaders } from "@/helpers/user.helper";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";

/**
 * POST { faceIds } – "not a face": soft-deletes the detected face in Immich
 * (DELETE /faces/{id} with force=false, Immich sets deletedAt). The photo itself is untouched.
 * There is no API to restore a soft-deleted face, so this cannot be undone from the tool.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const faceIds: string[] = Array.isArray(req.body?.faceIds) ? req.body.faceIds.slice(0, 500) : [];
  const results: { faceId: string; ok: boolean; error?: string }[] = [];
  for (const faceId of faceIds) {
    const s = ((await appDb.all(sql`SELECT assetId, currentPersonId, distance FROM face_suggestion WHERE faceId = ${faceId} AND ownerId = ${user.id}`)) as any[])[0];
    let assetId: string | undefined = s?.assetId;
    let fromPersonId: string | null = s?.currentPersonId ?? null;
    if (!s) {
      const r = await db.execute(sql`SELECT "assetId", "personId" FROM asset_face WHERE id = ${faceId}::uuid`);
      const f = ((r as any).rows ?? r)[0];
      if (!f) { results.push({ faceId, ok: false, error: "face not found" }); continue; }
      assetId = f.assetId; fromPersonId = f.personId ?? null;
    }
    let ok = false, error: string | undefined;
    try {
      const r = await fetch(`${ENV.IMMICH_URL}/api/faces/${faceId}`, {
        method: "DELETE", headers: getUserHeaders(user), body: JSON.stringify({ force: false }),
      });
      ok = r.ok;
      if (!ok) error = `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
    } catch (e: any) { error = String(e?.message || e); }
    await appDb.run(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, assetId, fromPersonId, toPersonId, distance, ok, error)
      VALUES (${new Date().toISOString()}, ${user.id}, ${user.name ?? null}, 'delete', ${faceId}, ${assetId}, ${fromPersonId}, NULL, ${s?.distance ?? null}, ${ok ? 1 : 0}, ${error ?? null})`);
    if (ok && s) await appDb.run(sql`UPDATE face_suggestion SET status = 'deleted' WHERE faceId = ${faceId}`);
    results.push({ faceId, ok, error });
  }
  return res.status(200).json({ results });
}
