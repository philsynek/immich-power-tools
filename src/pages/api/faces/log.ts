import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const limit = Math.min(parseInt(String(req.query.limit || "1000"), 10) || 1000, 5000);
  const rows = (await appDb.all(sql`SELECT * FROM face_review_log WHERE userId = ${user.id} ORDER BY id DESC LIMIT ${limit}`)) as any[];
  const ids = Array.from(new Set(rows.flatMap((r) => [r.fromPersonId, r.toPersonId]).filter(Boolean)));
  let names = new Map<string, string>();
  if (ids.length) {
    const r = await db.execute(sql`SELECT id, name FROM person WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    names = new Map((((r as any).rows ?? r) as any[]).map((p) => [p.id, p.name]));
  }
  return res.status(200).json(rows.map((r) => ({
    ...r,
    fromName: r.fromPersonId ? names.get(r.fromPersonId) || "(unnamed)" : null,
    toName: r.toPersonId ? names.get(r.toPersonId) || "(unnamed)" : null,
  })));
}
