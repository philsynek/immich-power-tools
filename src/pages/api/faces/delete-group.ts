import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { ENV } from "@/config/environment";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { getUserHeaders } from "@/helpers/user.helper";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";

/**
 * POST { clusterId } – "Not a face" for a whole unnamed group: soft-deletes every face detection of the group
 * in Immich (DELETE /faces/{id}, force=false). Faces excluded/rejected/hidden in the tool are kept.
 * The photos are untouched, but there is no API to restore deleted detections.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const clusterId = String(req.body?.clusterId || "");
  if (!clusterId) return res.status(400).json({ message: "clusterId required" });

  const r = await db.execute(sql`
    SELECT f.id::text AS id, f."assetId"::text AS "assetId" FROM asset_face f JOIN person p ON p.id = f."personId" JOIN asset a ON a.id = f."assetId"
    WHERE f."personId" = ${clusterId}::uuid AND f."deletedAt" IS NULL AND p.name = '' AND p."ownerId" = ${user.id}::uuid
        AND a."deletedAt" IS NULL AND a.visibility <> 'locked'`);
  const faces = ((r as any).rows ?? r) as { id: string; assetId: string }[];
  const keep = new Set((((await appDb.all(sql`SELECT faceId FROM face_suggestion WHERE ownerId = ${user.id}
    AND status IN ('rejected', 'excluded', 'hidden') AND currentPersonId = ${clusterId}`)) as any[])).map((x) => x.faceId));

  let deleted = 0, skipped = 0;
  const errors: string[] = [];
  for (const f of faces) {
    if (keep.has(f.id)) { skipped++; continue; }
    let ok = false, error: string | null = null;
    try {
      const d = await fetch(`${ENV.IMMICH_URL}/api/faces/${f.id}`, {
        method: "DELETE", headers: getUserHeaders(user), body: JSON.stringify({ force: false }),
      });
      ok = d.ok;
      if (!ok) error = `HTTP ${d.status} ${(await d.text()).slice(0, 200)}`;
    } catch (e: any) { error = String(e?.message || e); }
    await appDb.run(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, assetId, fromPersonId, ok, error)
      VALUES (${new Date().toISOString()}, ${user.id}, ${user.name ?? null}, 'delete', ${f.id}, ${f.assetId}, ${clusterId}, ${ok ? 1 : 0}, ${error})`);
    if (ok) { deleted++; await appDb.run(sql`UPDATE face_suggestion SET status = 'deleted' WHERE faceId = ${f.id}`); }
    else if (error) errors.push(error);
  }
  return res.status(200).json({ deleted, skipped, errors: errors.length, error: errors[0] ?? null });
}
