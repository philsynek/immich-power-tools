import type { NextApiRequest, NextApiResponse } from "next";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { getProgress, startScan } from "@/lib/faceReview/scan";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  if (req.method === "POST") {
    const reset = !!req.body?.reset;
    await startScan(user.id, reset);
  }
  return res.status(200).json(await getProgress(user.id));
}
