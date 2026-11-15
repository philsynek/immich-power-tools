import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { ENV } from "@/config/environment";
import { getUserHeaders } from "@/helpers/user.helper";

export interface AssignResult { faceId: string; ok: boolean; error?: string; logId?: number }

/**
 * Assigns one face to a person via Immich (PUT /faces/{personId}, body { id: faceId }),
 * writes the audit log and marks the suggestion as applied.
 * target: explicit person, otherwise the stored suggestion.
 */
export async function assignFace(user: any, faceId: string, target?: string): Promise<AssignResult> {
  const s = ((await appDb.all(sql`SELECT assetId, suggestedPersonId, distance FROM face_suggestion WHERE faceId = ${faceId} AND ownerId = ${user.id}`)) as any[])[0];
  const to: string | undefined = target || (s?.suggestedPersonId || undefined);
  if (!to) return { faceId, ok: false, error: "no suggestion" };
  // Re-read the current state: it may have changed since the scan.
  const cur = await db.execute(sql`SELECT "personId", "assetId" FROM asset_face WHERE id = ${faceId}::uuid AND "deletedAt" IS NULL`);
  const curRow = ((cur as any).rows ?? cur)[0];
  if (!curRow) return { faceId, ok: false, error: "face no longer exists" };
  const fromPersonId: string | null = curRow.personId ?? null;
  if (fromPersonId === to) return { faceId, ok: true };
  let ok = false, error: string | undefined;
  try {
    const r = await fetch(`${ENV.IMMICH_URL}/api/faces/${to}`, {
      method: "PUT", headers: getUserHeaders(user), body: JSON.stringify({ id: faceId }),
    });
    ok = r.ok;
    if (!ok) error = `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
  } catch (e: any) { error = String(e?.message || e); }
  const ins = (await appDb.all(sql`INSERT INTO face_review_log
    (ts, userId, userName, action, faceId, assetId, fromPersonId, toPersonId, distance, ok, error)
    VALUES (${new Date().toISOString()}, ${user.id}, ${user.name ?? null}, 'assign', ${faceId}, ${curRow.assetId},
            ${fromPersonId}, ${to}, ${s?.distance ?? null}, ${ok ? 1 : 0}, ${error ?? null})
    RETURNING id`)) as any[];
  if (ok && s) await appDb.run(sql`UPDATE face_suggestion SET status = 'applied' WHERE faceId = ${faceId}`);
  return { faceId, ok, error, logId: ins[0]?.id };
}
