import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { appDb } from "@/db";
import { ENV } from "@/config/environment";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { getUserHeaders } from "@/helpers/user.helper";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";
import { syncSuggestions } from "@/lib/faceReview/sync";

/**
 * POST { clusterId, name } – gives an unnamed group a name in Immich (PUT /people/{id} { name }).
 * The group becomes a named person; its faces drop out of the open suggestions (sync).
 * Undo via the log clears the name again.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const clusterId = String(req.body?.clusterId || "");
  const name = String(req.body?.name || "").trim();
  if (!clusterId || !name) return res.status(400).json({ message: "clusterId and name required" });

  let ok = false, error: string | null = null;
  try {
    const r = await fetch(`${ENV.IMMICH_URL}/api/people/${clusterId}`, {
      method: "PUT", headers: getUserHeaders(user), body: JSON.stringify({ name }),
    });
    ok = r.ok;
    if (!ok) error = `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
  } catch (e: any) { error = String(e?.message || e); }
  const ins = (await appDb.all(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, toPersonId, ok, error)
    VALUES (${new Date().toISOString()}, ${user.id}, ${user.name ?? null}, 'name-group', ${clusterId}, ${clusterId}, ${ok ? 1 : 0}, ${error})
    RETURNING id`)) as any[];
  if (ok) await syncSuggestions(user.id, true);
  return res.status(ok ? 200 : 502).json({ ok, error, logId: ins[0]?.id ?? null });
}
