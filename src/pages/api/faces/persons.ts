import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";

/** GET – all named people of the current user (for the "Assign to…" picker), sorted by name. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  const r = await db.execute(sql`
    SELECT id::text AS id, name, "isHidden" AS hidden FROM person
    WHERE "ownerId" = ${user.id}::uuid AND name <> ''
    ORDER BY lower(name)`);
  return res.status(200).json((r as any).rows ?? r);
}
