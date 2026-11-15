import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { ensureFaceReviewTables } from "./store";

export const MAX_DISTANCE = 0.65;
const BATCH = 50;
const TOP_K = 100;

export interface ScanProgress {
  running: boolean;
  scanned: number;
  stored: number;
  done: boolean;
  error?: string;
  startedAt?: string;
  updatedAt?: string | null;
}

const g = globalThis as any;
g.__faceScan = g.__faceScan || ({ running: false, scanned: 0, stored: 0, done: false } as ScanProgress);
const progress = (): ScanProgress => g.__faceScan;

export async function getProgress(ownerId: string): Promise<ScanProgress> {
  await ensureFaceReviewTables();
  const p = progress();
  if (p.running) return p;
  const r = await appDb.all(sql`SELECT scanned, stored, done, updatedAt FROM face_scan_state WHERE ownerId = ${ownerId}`) as any[];
  const row = r[0];
  return { ...p, scanned: row?.scanned ?? 0, stored: row?.stored ?? 0, done: !!row?.done, updatedAt: row?.updatedAt ?? null };
}

/** Starts (or resumes) the scan in the background. reset=true starts from scratch. */
export async function startScan(ownerId: string, reset: boolean) {
  await ensureFaceReviewTables();
  const p = progress();
  if (p.running) return p;
  if (reset) {
    await appDb.run(sql`DELETE FROM face_suggestion WHERE ownerId = ${ownerId} AND status = 'open'`);
    await appDb.run(sql`DELETE FROM face_scan_state WHERE ownerId = ${ownerId}`);
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

async function run(ownerId: string) {
  const p = progress();
  const st = (await appDb.all(sql`SELECT cursor, scanned, stored FROM face_scan_state WHERE ownerId = ${ownerId}`)) as any[];
  let cursor: string = st[0]?.cursor || "00000000-0000-0000-0000-000000000000";
  p.scanned = st[0]?.scanned ?? 0;
  p.stored = st[0]?.stored ?? 0;

  for (;;) {
    const res = await db.execute(sql`
      SELECT f.id AS "faceId", f."assetId", f."personId" AS "currentPersonId",
             f."imageWidth" AS w, f."imageHeight" AS h,
             f."boundingBoxX1" AS x1, f."boundingBoxY1" AS y1, f."boundingBoxX2" AS x2, f."boundingBoxY2" AS y2,
             a."localDateTime" AS ldt, n.pids, n.ds
      FROM (
        SELECT f.* FROM asset_face f
        JOIN asset a0 ON a0.id = f."assetId"
        LEFT JOIN person p0 ON p0.id = f."personId"
        WHERE f."deletedAt" IS NULL AND a0."ownerId" = ${ownerId}::uuid AND a0."deletedAt" IS NULL AND a0.visibility <> 'locked'
          AND f."imageWidth" > 0 AND (f."personId" IS NULL OR p0.name = '')
          AND f.id > ${cursor}::uuid
        ORDER BY f.id LIMIT ${BATCH}
      ) f
      JOIN face_search fs ON fs."faceId" = f.id
      JOIN asset a ON a.id = f."assetId"
      LEFT JOIN LATERAL (
        -- Pure ANN index scan first (top-K over all faces), then keep only named people.
        SELECT array_agg(t.pid ORDER BY t.d) AS pids, array_agg(t.d ORDER BY t.d) AS ds FROM (
          SELECT f2."personId" AS pid, min(nb.d) AS d
          FROM (
            SELECT fs2."faceId", fs2.embedding <=> fs.embedding AS d
            FROM face_search fs2
            ORDER BY fs2.embedding <=> fs.embedding
            LIMIT ${TOP_K}
          ) nb
          JOIN asset_face f2 ON f2.id = nb."faceId" AND f2."deletedAt" IS NULL
          JOIN person p2 ON p2.id = f2."personId" AND p2.name <> '' AND p2."ownerId" = ${ownerId}::uuid
          GROUP BY f2."personId" ORDER BY d LIMIT 2
        ) t
      ) n ON true
      ORDER BY f.id
    `);
    const rows: any[] = (res as any).rows ?? (res as any);

    // Cursor must advance over the candidate set, not only over rows with embeddings.
    const next = await db.execute(sql`
      SELECT id::text AS m FROM (
        SELECT f.id FROM asset_face f
        JOIN asset a0 ON a0.id = f."assetId"
        LEFT JOIN person p0 ON p0.id = f."personId"
        WHERE f."deletedAt" IS NULL AND a0."ownerId" = ${ownerId}::uuid AND a0."deletedAt" IS NULL AND a0.visibility <> 'locked'
          AND f."imageWidth" > 0 AND (f."personId" IS NULL OR p0.name = '')
          AND f.id > ${cursor}::uuid
        ORDER BY f.id LIMIT ${BATCH}
      ) x ORDER BY id DESC LIMIT 1`);
    const m = ((next as any).rows ?? next)[0]?.m as string | null;
    if (!m) break;
    cursor = m;

    const now = new Date().toISOString();
    // One multi-row INSERT per batch (a single commit) instead of one commit per row.
    const values: ReturnType<typeof sql>[] = [];
    for (const r of rows) {
      const pids = pgArray(r.pids);
      const ds = pgArray(r.ds).map(Number);
      if (!pids.length || ds[0] > MAX_DISTANCE) continue;
      values.push(sql`(${r.faceId}, ${r.assetId}, ${ownerId}, ${pids[0]}, ${ds[0]}, ${pids[1] ?? null}, ${ds[1] ?? null},
          ${r.currentPersonId ?? null}, ${r.ldt ? new Date(r.ldt).toISOString() : null},
          ${r.w}, ${r.h}, ${r.x1}, ${r.y1}, ${r.x2}, ${r.y2}, 'open', ${now})`);
    }
    if (values.length) {
      await appDb.run(sql`INSERT INTO face_suggestion
        (faceId, assetId, ownerId, suggestedPersonId, distance, secondPersonId, secondDistance, currentPersonId,
         capturedAt, imageWidth, imageHeight, x1, y1, x2, y2, status, scannedAt)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT(faceId) DO UPDATE SET suggestedPersonId=excluded.suggestedPersonId, distance=excluded.distance,
          secondPersonId=excluded.secondPersonId, secondDistance=excluded.secondDistance,
          currentPersonId=excluded.currentPersonId, scannedAt=excluded.scannedAt
        WHERE face_suggestion.status = 'open'`);
      p.stored += values.length;
    }
    p.scanned += rows.length;
    console.log(`[unnamed-faces] scanned ${p.scanned}, suggestions ${p.stored}`);
    await appDb.run(sql`INSERT INTO face_scan_state (ownerId, cursor, scanned, stored, done, updatedAt)
      VALUES (${ownerId}, ${cursor}, ${p.scanned}, ${p.stored}, 0, ${now})
      ON CONFLICT(ownerId) DO UPDATE SET cursor=excluded.cursor, scanned=excluded.scanned, stored=excluded.stored, updatedAt=excluded.updatedAt`);
  }
  p.done = true;
  await appDb.run(sql`UPDATE face_scan_state SET done = 1, updatedAt = ${new Date().toISOString()} WHERE ownerId = ${ownerId}`);
}
