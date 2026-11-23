import { sql } from "drizzle-orm";
import { appDb } from "@/db";
import { FacesUser, immich, liveFace, logAction } from "./common";
import type { IFaceActionResult } from "@/types/faces";

/**
 * Assigns one face to a person via Immich (PUT /faces/{personId}, body { id: faceId }),
 * writes the audit log and marks the suggestion as applied.
 * target: explicit person, otherwise the stored suggestion.
 */
export async function assignFace(user: FacesUser, faceId: string, target?: string): Promise<IFaceActionResult> {
  const s = ((await appDb.all(sql`SELECT suggested_person_id AS "suggestedPersonId", distance FROM face_suggestions
    WHERE face_id = ${faceId} AND owner_id = ${user.id}`)) as any[])[0];
  const to: string | undefined = target || s?.suggestedPersonId || undefined;
  if (!to) return { faceId, ok: false, error: "no suggestion" };
  // Re-read the live state: it may have changed since the scan.
  const cur = await liveFace(faceId, true);
  if (!cur) return { faceId, ok: false, error: "face no longer exists" };
  if (cur.personId === to) return { faceId, ok: true };
  const r = await immich(user, "PUT", `/faces/${to}`, { id: faceId });
  const logId = await logAction(user, {
    action: "assign", faceId, assetId: cur.assetId, fromPersonId: cur.personId, toPersonId: to,
    distance: s?.distance ?? null, ok: r.ok, error: r.error,
  });
  if (r.ok && s) await appDb.run(sql`UPDATE face_suggestions SET status = 'applied' WHERE face_id = ${faceId}`);
  return { faceId, ok: r.ok, error: r.error ?? undefined, logId: logId ?? undefined };
}
