import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";
import { assignFace, AssignResult } from "@/lib/faceReview/assign";
import { syncSuggestions } from "@/lib/faceReview/sync";

/**
 * POST { clusterIds: string[] (or clusterId), personId } – assigns every face of the given unnamed groups to personId.
 * Faces thrown out ("excluded") or rejected in the tool are skipped – that's how outliers are kept out.
 * Faces are reassigned one by one, so each one can be undone from the log.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const clusterIds: string[] = Array.isArray(req.body?.clusterIds) ? req.body.clusterIds : req.body?.clusterId ? [String(req.body.clusterId)] : [];
  const personId = String(req.body?.personId || "");
  if (!clusterIds.length || !personId) return res.status(400).json({ message: "clusterIds and personId required" });

  const results: AssignResult[] = [];
  let skipped = 0;
  for (const clusterId of clusterIds.slice(0, 200)) {
    const r = await db.execute(sql`
      SELECT f.id::text AS id FROM asset_face f JOIN person p ON p.id = f."personId" JOIN asset a ON a.id = f."assetId"
      WHERE f."personId" = ${clusterId}::uuid AND f."deletedAt" IS NULL AND p.name = '' AND p."ownerId" = ${user.id}::uuid
        AND a."deletedAt" IS NULL AND a.visibility <> 'locked'`);
    const ids = (((r as any).rows ?? r) as any[]).map((x) => x.id as string);
    const skip = new Set((((await appDb.all(sql`SELECT faceId FROM face_suggestion WHERE ownerId = ${user.id}
      AND status IN ('rejected', 'excluded', 'hidden') AND currentPersonId = ${clusterId}`)) as any[])).map((x) => x.faceId));
    for (const id of ids) {
      if (skip.has(id)) { skipped++; continue; }
      results.push(await assignFace(user, id, personId));
    }
  }
  await syncSuggestions(user.id, true);
  return res.status(200).json({ results, skipped });
}
