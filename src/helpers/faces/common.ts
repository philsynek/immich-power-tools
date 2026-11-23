import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { ENV } from "@/config/environment";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { getUserHeaders } from "@/helpers/user.helper";

/** Rows of a node-postgres result (drizzle returns either the result object or the rows). */
export const rowsOf = (r: any): any[] => (r as any).rows ?? r;
export const uuidList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
export const textList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

/**
 * Faces Immich still shows: not deleted, photo not in the trash, never in the locked folder.
 * Immich 3.x keeps the asset state denormalised on asset_face, so no join on asset is needed.
 */
export const visibleFace = (alias: string) => {
  const f = sql.raw(alias);
  return sql`${f}."deletedAt" IS NULL AND ${f}."assetDeletedAt" IS NULL AND ${f}."assetVisibility" <> 'locked'`;
};

let pragmas: Promise<void> | null = null;
/**
 * WAL + synchronous=NORMAL for the app DB: far fewer fsyncs. The local libsql driver is synchronous,
 * so slow commits during a scan would otherwise block the whole Node process.
 */
export function prepareFacesDb(): Promise<void> {
  if (!pragmas) {
    pragmas = (async () => {
      await appDb.run(sql`PRAGMA journal_mode = WAL`);
      await appDb.run(sql`PRAGMA synchronous = NORMAL`);
    })();
  }
  return pragmas;
}

export interface FacesUser { id: string; name?: string | null; [k: string]: any }

/** Calls the Immich API as the current user. Never throws. */
export async function immich(user: FacesUser, method: string, path: string, body?: unknown) {
  try {
    const r = await fetch(`${ENV.IMMICH_URL}/api${path}`, {
      method, headers: getUserHeaders(user as any), body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`, data: null as any };
    const text = await r.text();
    return { ok: true, error: null as string | null, data: text ? JSON.parse(text) : null };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e), data: null as any };
  }
}

export interface LogEntry {
  action: string; faceId: string; assetId?: string | null; fromPersonId?: string | null; toPersonId?: string | null;
  distance?: number | null; ok: boolean; error?: string | null;
}
/** Writes one audit-log row and returns its id. For group actions faceId holds the group id. */
export async function logAction(user: FacesUser, e: LogEntry, ts = new Date().toISOString()): Promise<number | null> {
  const r = (await appDb.all(sql`INSERT INTO face_review_log
    (ts, user_id, user_name, action, face_id, asset_id, from_person_id, to_person_id, distance, ok, error)
    VALUES (${ts}, ${user.id}, ${user.name ?? null}, ${e.action}, ${e.faceId}, ${e.assetId ?? null}, ${e.fromPersonId ?? null},
            ${e.toPersonId ?? null}, ${e.distance ?? null}, ${e.ok ? 1 : 0}, ${e.error ?? null})
    RETURNING id`)) as any[];
  return r[0]?.id ?? null;
}

/** Names of the user's people (Immich 3.x: person is keyed by ownerId + personGroupId). */
export async function personNames(ownerId: string, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = Array.from(new Set(ids.filter(Boolean))) as string[];
  const names: Record<string, string> = {};
  if (!list.length) return names;
  const r = await db.execute(sql`SELECT "personGroupId"::text AS id, name FROM person
    WHERE "ownerId" = ${ownerId}::uuid AND "personGroupId" IN (${uuidList(list)})`);
  rowsOf(r).forEach((p) => { names[p.id] = p.name; });
  return names;
}

/** Current group (personGroupId) and asset of a face, or null if it no longer exists. */
export async function liveFace(faceId: string, onlyVisible = false): Promise<{ assetId: string; personId: string | null } | null> {
  const r = await db.execute(sql`SELECT f."assetId"::text AS "assetId", f."personGroupId"::text AS "personId"
    FROM asset_face f WHERE f.id = ${faceId}::uuid ${onlyVisible ? sql`AND ${visibleFace("f")}` : sql``}`);
  return rowsOf(r)[0] ?? null;
}

/** Face ids of an unnamed group the user owns that Immich still shows. */
export async function groupFaces(ownerId: string, clusterId: string): Promise<{ id: string; assetId: string }[]> {
  const r = await db.execute(sql`
    SELECT f.id::text AS id, f."assetId"::text AS "assetId" FROM asset_face f
    JOIN person p ON p."personGroupId" = f."personGroupId" AND p."ownerId" = ${ownerId}::uuid
    WHERE f."personGroupId" = ${clusterId}::uuid AND f."ownerId" = ${ownerId}::uuid AND p.name = '' AND ${visibleFace("f")}`);
  return rowsOf(r);
}

/** Faces of a group the user kept out of group actions in the tool (stranger / excluded / hidden). */
export async function keptOutOfGroup(ownerId: string, clusterId: string): Promise<Set<string>> {
  const r = (await appDb.all(sql`SELECT face_id AS id FROM face_suggestions WHERE owner_id = ${ownerId}
    AND status IN ('rejected', 'excluded', 'hidden') AND current_person_id = ${clusterId}`)) as any[];
  return new Set(r.map((x) => x.id));
}

export const idList = (v: unknown, max = 500): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, max) : []);

type Handler = (req: NextApiRequest, user: FacesUser) => Promise<{ status?: number; body: any }>;
/** Shared API route wrapper: method check, auth, app DB pragmas, error handling. */
export function facesRoute(methods: string[], fn: Handler) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (!methods.includes(req.method || "")) return res.status(405).json({ message: "Method Not Allowed" });
    const user = await getCurrentUser(req);
    if (!user) return res.status(403).json({ message: "Unauthorized" });
    try {
      await prepareFacesDb();
      const { status = 200, body } = await fn(req, user as FacesUser);
      return res.status(status).json(body);
    } catch (e: any) {
      console.error("[unnamed-faces]", e);
      return res.status(500).json({ message: String(e?.message || e) });
    }
  };
}

