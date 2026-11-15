import type { NextApiRequest, NextApiResponse } from "next";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";
import { assignFace, AssignResult } from "@/lib/faceReview/assign";

/** POST { faceIds: string[], personId?: string } – assign faces to their suggested person (or override). */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const faceIds: string[] = Array.isArray(req.body?.faceIds) ? req.body.faceIds.slice(0, 500) : [];
  const override: string | undefined = req.body?.personId || undefined;
  const results: AssignResult[] = [];
  for (const faceId of faceIds) results.push(await assignFace(user, faceId, override));
  return res.status(200).json({ results });
}
