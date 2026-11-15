import type { NextApiRequest, NextApiResponse } from "next";
import { ENV } from "@/config/environment";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { getUserHeaders } from "@/helpers/user.helper";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";
import { assignFace } from "@/lib/faceReview/assign";

/**
 * POST { faceId, name } – creates a new named person in Immich (POST /people) and assigns the face to it.
 * Undo (via the log entry of the assignment) moves the face back; the new person stays (empty).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const faceId = String(req.body?.faceId || "");
  const name = String(req.body?.name || "").trim();
  if (!faceId || !name) return res.status(400).json({ message: "faceId and name required" });

  const c = await fetch(`${ENV.IMMICH_URL}/api/people`, { method: "POST", headers: getUserHeaders(user), body: JSON.stringify({ name }) });
  if (!c.ok) return res.status(502).json({ ok: false, error: `create person: HTTP ${c.status} ${(await c.text()).slice(0, 200)}` });
  const person = await c.json();
  const result = await assignFace(user, faceId, person.id);
  return res.status(result.ok ? 200 : 502).json({ ...result, personId: person.id });
}
