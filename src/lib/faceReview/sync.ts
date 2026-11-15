import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";

const g = globalThis as any;
g.__faceSync = g.__faceSync || new Map<string, number>();
const lastSync: Map<string, number> = g.__faceSync;
const CHUNK = 1000;

/**
 * Brings the stored suggestions in line with the live Immich state (Immich may have re-clustered,
 * the user may have named a group, assigned, deleted or trashed things since the scan):
 *  - face now belongs to a named person, or the face is gone/deleted        → status 'resolved'
 *  - photo is in the trash or in the locked folder                           → status 'unavailable'
 *    (re-checked every time: comes back as 'open' when restored / unlocked)
 *  - face now sits in another unnamed group or has no person                 → currentPersonId updated
 * Runs at most once a minute per user unless forced.
 */
export async function syncSuggestions(ownerId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastSync.get(ownerId) ?? 0) < 60_000) return;
  lastSync.set(ownerId, now);

  const rows = (await appDb.all(sql`SELECT faceId, currentPersonId, status FROM face_suggestion
    WHERE ownerId = ${ownerId} AND status IN ('open', 'excluded', 'unavailable')`)) as { faceId: string; currentPersonId: string | null; status: string }[];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const r = await db.execute(sql`
      SELECT f.id::text AS id, f."personId"::text AS pid, (f."deletedAt" IS NOT NULL) AS del, p.name,
             (a.id IS NULL OR a."deletedAt" IS NOT NULL OR a.visibility = 'locked') AS hidden
      FROM asset_face f
      LEFT JOIN person p ON p.id = f."personId"
      LEFT JOIN asset a ON a.id = f."assetId"
      WHERE f.id IN (${sql.join(chunk.map((x) => sql`${x.faceId}::uuid`), sql`, `)})`);
    const live = new Map((((r as any).rows ?? r) as any[]).map((x) => [x.id, x]));
    const resolved: string[] = [], unavailable: string[] = [], reopened: string[] = [];
    const moved: { id: string; pid: string | null }[] = [];
    for (const row of chunk) {
      const l = live.get(row.faceId);
      if (!l || l.del || (l.pid && l.name)) { resolved.push(row.faceId); continue; }
      if (l.hidden) { if (row.status !== "unavailable") unavailable.push(row.faceId); continue; }
      if (row.status === "unavailable") reopened.push(row.faceId);
      if ((l.pid ?? null) !== (row.currentPersonId ?? null)) moved.push({ id: row.faceId, pid: l.pid ?? null });
    }
    const setStatus = async (ids: string[], status: string) => {
      if (ids.length) await appDb.run(sql`UPDATE face_suggestion SET status = ${status}
        WHERE faceId IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
    };
    await setStatus(resolved, "resolved");
    await setStatus(unavailable, "unavailable");
    await setStatus(reopened, "open");
    for (const m of moved) await appDb.run(sql`UPDATE face_suggestion SET currentPersonId = ${m.pid} WHERE faceId = ${m.id}`);
  }
}
