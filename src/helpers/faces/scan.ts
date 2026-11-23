import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { rowsOf, visibleFace } from "./common";
import type { IFaceScanProgress } from "@/types/faces";

/** Cosine distance above which a match is not stored as a suggestion. */
export const MAX_DISTANCE = 0.65;
const BATCH = 50;
const TOP_K = 100;

const g = globalThis as any;
g.__faceScan = g.__faceScan || ({ running: false, scanned: 0, stored: 0, done: false } as IFaceScanProgress);
const progress = (): IFaceScanProgress => g.__faceScan;

export async function getScanProgress(ownerId: string): Promise<IFaceScanProgress> {
  const p = progress();
  if (p.running) return p;
  const r = (await appDb.all(sql`SELECT scanned, stored, done, updated_at AS "updatedAt" FROM face_scan_state WHERE owner_id = ${ownerId}`)) as any[];
  const row = r[0];
  return { ...p, scanned: row?.scanned ?? 0, stored: row?.stored ?? 0, done: !!row?.done, updatedAt: row?.updatedAt ?? null };
}

/** Starts (or resumes) the scan in the background. reset=true discards open suggestions and starts from scratch. */
export async function startScan(ownerId: string, reset: boolean) {
  const p = progress();
  if (p.running) return p;
  if (reset) {
    await appDb.run(sql`DELETE FROM face_suggestions WHERE owner_id = ${ownerId} AND status = 'open'`);
    await appDb.run(sql`DELETE FROM face_scan_state WHERE owner_id = ${ownerId}`);
  }
  Object.assign(p, { running: true, error: undefined, done: false, startedAt: new Date().toISOString() });
  run(ownerId).catch((e) => {
    console.error("[unnamed-faces] scan failed:", e);
    p.error = String(e?.message || e);
  }).finally(() => {
    p.running = false;
  });
  return p;
}

/** node-pg parses most arrays, but fall back to parsing the "{a,b}" text form. */
function pgArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.startsWith("{")) return v.slice(1, -1).split(",").filter(Boolean);
  return [];
}

/** Next batch of candidate faces: no person or an unnamed group, owned by the user, still visible in Immich. */
const candidates = (ownerId: string, cursor: string) => sql`
  SELECT f.* FROM asset_face f
  LEFT JOIN person p0 ON p0."personGroupId" = f."personGroupId" AND p0."ownerId" = ${ownerId}::uuid
  WHERE f."ownerId" = ${ownerId}::uuid AND ${visibleFace("f")}
    AND f."imageWidth" > 0 AND (f."personGroupId" IS NULL OR p0.name = '' OR p0.name IS NULL)
    AND f.id > ${cursor}::uuid
  ORDER BY f.id LIMIT ${BATCH}`;

async function run(ownerId: string) {
  const p = progress();
  const st = (await appDb.all(sql`SELECT cursor, scanned, stored FROM face_scan_state WHERE owner_id = ${ownerId}`)) as any[];
  let cursor: string = st[0]?.cursor || "00000000-0000-0000-0000-000000000000";
  p.scanned = st[0]?.scanned ?? 0;
  p.stored = st[0]?.stored ?? 0;

  for (;;) {
    const rows = rowsOf(await db.execute(sql`
      SELECT f.id AS "faceId", f."assetId", f."personGroupId" AS "currentPersonId",
             f."imageWidth" AS w, f."imageHeight" AS h,
             f."boundingBoxX1" AS x1, f."boundingBoxY1" AS y1, f."boundingBoxX2" AS x2, f."boundingBoxY2" AS y2,
             a."localDateTime" AS ldt, n.pids, n.ds
      FROM (${candidates(ownerId, cursor)}) f
      JOIN face_search fs ON fs."faceId" = f.id
      JOIN asset a ON a.id = f."assetId"
      LEFT JOIN LATERAL (
        -- Pure ANN index scan first (top-K over all faces), then keep only the user's named people.
        SELECT array_agg(t.pid ORDER BY t.d) AS pids, array_agg(t.d ORDER BY t.d) AS ds FROM (
          SELECT f2."personGroupId" AS pid, min(nb.d) AS d
          FROM (
            SELECT fs2."faceId", fs2.embedding <=> fs.embedding AS d
            FROM face_search fs2
            ORDER BY fs2.embedding <=> fs.embedding
            LIMIT ${TOP_K}
          ) nb
          JOIN asset_face f2 ON f2.id = nb."faceId" AND f2."deletedAt" IS NULL
          JOIN person p2 ON p2."personGroupId" = f2."personGroupId" AND p2."ownerId" = ${ownerId}::uuid AND p2.name <> ''
          GROUP BY f2."personGroupId" ORDER BY d LIMIT 2
        ) t
      ) n ON true
      ORDER BY f.id
    `));

    // The cursor must advance over the candidate set, not only over rows with embeddings.
    const next = await db.execute(sql`SELECT id::text AS m FROM (${candidates(ownerId, cursor)}) x ORDER BY id DESC LIMIT 1`);
    const m = rowsOf(next)[0]?.m as string | undefined;
    if (!m) break;
    cursor = m;

    const now = new Date().toISOString();
    // One multi-row INSERT per batch (a single commit) instead of one commit per row.
    const values = [];
    for (const r of rows) {
      const pids = pgArray(r.pids);
      const ds = pgArray(r.ds).map(Number);
      if (!pids.length || ds[0] > MAX_DISTANCE) continue;
      values.push(sql`(${r.faceId}, ${r.assetId}, ${ownerId}, ${pids[0]}, ${ds[0]}, ${pids[1] ?? null}, ${ds[1] ?? null},
          ${r.currentPersonId ?? null}, ${r.ldt ? new Date(r.ldt).toISOString() : null},
          ${r.w}, ${r.h}, ${r.x1}, ${r.y1}, ${r.x2}, ${r.y2}, 'open', ${now})`);
    }
    if (values.length) {
      await appDb.run(sql`INSERT INTO face_suggestions
        (face_id, asset_id, owner_id, suggested_person_id, distance, second_person_id, second_distance, current_person_id,
         captured_at, image_width, image_height, x1, y1, x2, y2, status, scanned_at)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT(face_id) DO UPDATE SET suggested_person_id = excluded.suggested_person_id, distance = excluded.distance,
          second_person_id = excluded.second_person_id, second_distance = excluded.second_distance,
          current_person_id = excluded.current_person_id, scanned_at = excluded.scanned_at
        WHERE face_suggestions.status = 'open'`);
      p.stored += values.length;
    }
    p.scanned += rows.length;
    console.log(`[unnamed-faces] scanned ${p.scanned}, suggestions ${p.stored}`);
    await appDb.run(sql`INSERT INTO face_scan_state (owner_id, cursor, scanned, stored, done, updated_at)
      VALUES (${ownerId}, ${cursor}, ${p.scanned}, ${p.stored}, 0, ${now})
      ON CONFLICT(owner_id) DO UPDATE SET cursor = excluded.cursor, scanned = excluded.scanned, stored = excluded.stored,
        updated_at = excluded.updated_at`);
  }
  p.done = true;
  await appDb.run(sql`UPDATE face_scan_state SET done = 1, updated_at = ${new Date().toISOString()} WHERE owner_id = ${ownerId}`);
}
