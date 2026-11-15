import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";
import { syncSuggestions } from "@/lib/faceReview/sync";
import { majoritySql } from "@/lib/faceReview/groups";

/** Named people with open suggestions: total faces, loose faces, and groups whose majority is this person. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  await syncSuggestions(user.id, req.query.sync === "1");
  const rows = (await appDb.all(sql`
    SELECT suggestedPersonId AS personId, COUNT(*) AS total,
      SUM(CASE WHEN currentPersonId IS NULL THEN 1 ELSE 0 END) AS loose
    FROM face_suggestion WHERE ownerId = ${user.id} AND status IN ('open', 'excluded') AND suggestedPersonId <> ''
    GROUP BY suggestedPersonId`)) as any[];
  if (!rows.length) return res.status(200).json([]);
  const groups = (await appDb.all(sql`SELECT pid, count(*) AS g FROM (${majoritySql(user.id)}) GROUP BY pid`)) as any[];
  const groupCount = new Map(groups.map((x) => [x.pid, Number(x.g)]));
  const ids = rows.map((r) => r.personId);
  const res2 = await db.execute(sql`
    SELECT id, name, "birthDate"::text AS "birthDate" FROM person
    WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  const persons: any[] = (res2 as any).rows ?? (res2 as any);
  const byId = new Map(persons.map((p) => [p.id, p]));
  const out = rows
    .map((r) => ({
      personId: r.personId, total: Number(r.total), loose: Number(r.loose), groups: groupCount.get(r.personId) ?? 0,
      name: byId.get(r.personId)?.name ?? "?", birthDate: byId.get(r.personId)?.birthDate ?? null,
    }))
    .sort((a, b) => b.total - a.total);
  return res.status(200).json(out);
}
