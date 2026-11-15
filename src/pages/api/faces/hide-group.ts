import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { appDb } from "@/db";
import { ENV } from "@/config/environment";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { getUserHeaders } from "@/helpers/user.helper";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";

/**
 * POST { clusterId } – "Stranger": hides an unnamed group.
 *  - in the tool: its open suggestions get status 'hidden' (they survive a rescan)
 *  - in Immich: the person is hidden (PUT /people/{id} { isHidden: true })
 * Undo via the log (reverts both).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const clusterId = String(req.body?.clusterId || "");
  if (!clusterId) return res.status(400).json({ message: "clusterId required" });

  let ok = false, error: string | null = null;
  try {
    const r = await fetch(`${ENV.IMMICH_URL}/api/people/${clusterId}`, {
      method: "PUT", headers: getUserHeaders(user), body: JSON.stringify({ isHidden: true }),
    });
    ok = r.ok;
    if (!ok) error = `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
  } catch (e: any) { error = String(e?.message || e); }
  if (ok) {
    await appDb.run(sql`UPDATE face_suggestion SET status = 'hidden'
      WHERE ownerId = ${user.id} AND currentPersonId = ${clusterId} AND status IN ('open', 'excluded')`);
  }
  // The log's faceId column holds the group id for group-level actions.
  const ins = (await appDb.all(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, fromPersonId, ok, error)
    VALUES (${new Date().toISOString()}, ${user.id}, ${user.name ?? null}, 'hide-group', ${clusterId}, ${clusterId}, ${ok ? 1 : 0}, ${error})
    RETURNING id`)) as any[];
  return res.status(ok ? 200 : 502).json({ ok, error, logId: ins[0]?.id ?? null });
}
