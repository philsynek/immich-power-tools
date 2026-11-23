import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { personNames, rowsOf, textList, uuidList, visibleFace } from "./common";
import { majoritySql } from "./groups";
import type {
  IFaceGroupInfo, IFaceGroupsResponse, IFaceLogRow, IFaceSuggestionsQuery, IFaceSuggestionsResponse, IFacesNamedPerson,
  IFacesPersonRow,
} from "@/types/faces";

/** Columns of face_suggestions in the shape the UI expects. */
const FACE_COLS = sql`face_id AS "faceId", asset_id AS "assetId", suggested_person_id AS "suggestedPersonId", distance,
  status = 'excluded' AS excluded, second_person_id AS "secondPersonId", second_distance AS "secondDistance",
  current_person_id AS "currentPersonId", captured_at AS "capturedAt",
  image_width AS w, image_height AS h, x1, y1, x2, y2`;

/** Current number of visible faces per group, straight from Immich (assigned faces have left already). */
async function groupSizes(ownerId: string, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const r = await db.execute(sql`SELECT f."personGroupId"::text AS id, count(*)::int AS n FROM asset_face f
    WHERE f."personGroupId" IN (${uuidList(ids)}) AND f."ownerId" = ${ownerId}::uuid AND ${visibleFace("f")}
    GROUP BY f."personGroupId"`);
  return new Map(rowsOf(r).map((x) => [x.id, Number(x.n)]));
}

/** Open-suggestion breakdown (who the faces of each group look like). */
async function breakdown(ownerId: string, ids: string[]) {
  if (!ids.length) return [] as { cid: string; pid: string; n: number }[];
  return (await appDb.all(sql`
    SELECT current_person_id AS cid, suggested_person_id AS pid, count(*) AS n FROM face_suggestions
    WHERE owner_id = ${ownerId} AND status = 'open' AND suggested_person_id <> '' AND current_person_id IN (${textList(ids)})
    GROUP BY current_person_id, suggested_person_id ORDER BY n DESC`)) as { cid: string; pid: string; n: number }[];
}

/** Named people with open suggestions: total faces, loose faces, and groups whose majority is this person. */
export async function listFacePeople(ownerId: string): Promise<IFacesPersonRow[]> {
  const rows = (await appDb.all(sql`
    SELECT suggested_person_id AS "personId", COUNT(*) AS total,
      SUM(CASE WHEN current_person_id IS NULL THEN 1 ELSE 0 END) AS loose
    FROM face_suggestions WHERE owner_id = ${ownerId} AND status IN ('open', 'excluded') AND suggested_person_id <> ''
    GROUP BY suggested_person_id`)) as any[];
  if (!rows.length) return [];
  const groups = (await appDb.all(sql`SELECT pid, count(*) AS g FROM (${majoritySql(ownerId)}) GROUP BY pid`)) as any[];
  const groupCount = new Map(groups.map((x) => [x.pid, Number(x.g)]));
  const r = await db.execute(sql`
    SELECT "personGroupId"::text AS id, name, "birthDate"::text AS "birthDate" FROM person
    WHERE "ownerId" = ${ownerId}::uuid AND "personGroupId" IN (${uuidList(rows.map((x) => x.personId))})`);
  const byId = new Map(rowsOf(r).map((p) => [p.id, p]));
  return rows
    .map((x) => ({
      personId: x.personId, total: Number(x.total), loose: Number(x.loose), groups: groupCount.get(x.personId) ?? 0,
      name: byId.get(x.personId)?.name ?? "?", birthDate: byId.get(x.personId)?.birthDate ?? null,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Unnamed groups whose majority suggestion is personId. sort=size|share|best (best = closest face), dir=asc|desc.
 * Each group carries a representative face (closest face suggesting personId) and the suggestion breakdown.
 */
export async function listFaceGroups(ownerId: string, q: { personId: string; sort?: string; dir?: string; limit: number; offset: number }): Promise<IFaceGroupsResponse> {
  const all = (await appDb.all(sql`SELECT cid, n, tot, md FROM (${majoritySql(ownerId)}) WHERE pid = ${q.personId}`)) as any[];
  if (!all.length) return { total: 0, groups: [], names: {} };
  const sizeBy = await groupSizes(ownerId, all.map((g) => g.cid));
  // Only groups that are still unnamed in Immich.
  const nm = await db.execute(sql`SELECT "personGroupId"::text AS id FROM person
    WHERE "ownerId" = ${ownerId}::uuid AND "personGroupId" IN (${uuidList(all.map((g) => g.cid))}) AND name = ''`);
  const stillUnnamed = new Set(rowsOf(nm).map((x) => x.id));
  const open = all.filter((g) => stillUnnamed.has(g.cid));
  const sortKey = ["size", "share", "best"].includes(String(q.sort)) ? String(q.sort) : "size";
  const sign = q.dir === "asc" ? 1 : -1;
  const size = (g: any) => sizeBy.get(g.cid) ?? Number(g.tot);
  const key = (g: any) => (sortKey === "share" ? g.n / g.tot : sortKey === "best" ? g.md : size(g));
  open.sort((a, b) => sign * (key(a) - key(b)) || size(b) - size(a));
  const page = open.slice(q.offset, q.offset + q.limit);
  const cids = page.map((g) => g.cid as string);
  if (!cids.length) return { total: open.length, groups: [], names: {} };

  const reps = (await appDb.all(sql`
    SELECT * FROM (
      SELECT current_person_id AS cid, face_id AS "faceId", asset_id AS "assetId", distance, captured_at AS "capturedAt",
             image_width AS w, image_height AS h, x1, y1, x2, y2,
             row_number() OVER (PARTITION BY current_person_id ORDER BY distance) AS rk
      FROM face_suggestions
      WHERE owner_id = ${ownerId} AND status = 'open' AND suggested_person_id = ${q.personId} AND current_person_id IN (${textList(cids)})
    ) WHERE rk = 1`)) as any[];
  const repBy = new Map(reps.map(({ rk, cid, ...r }) => [cid, r]));
  const bd = await breakdown(ownerId, cids);
  const ex = (await appDb.all(sql`
    SELECT current_person_id AS cid, count(*) AS n FROM face_suggestions
    WHERE owner_id = ${ownerId} AND status IN ('excluded', 'rejected') AND current_person_id IN (${textList(cids)})
    GROUP BY current_person_id`)) as any[];
  const exBy = new Map(ex.map((x) => [x.cid, Number(x.n)]));
  const names = await personNames(ownerId, [q.personId, ...bd.map((x) => x.pid)]);

  return {
    total: open.length,
    names,
    groups: page.map((g) => {
      const sz = size(g);
      const excluded = exBy.get(g.cid) ?? 0;
      return {
        clusterId: g.cid,
        size: sz,
        majority: Number(g.n),
        withSuggestion: Number(g.tot),
        excluded,
        noSuggestion: Math.max(0, sz - Number(g.tot) - excluded),
        breakdown: bd.filter((x) => x.cid === g.cid).map((x) => ({ personId: x.pid, n: Number(x.n) })),
        rep: repBy.get(g.cid) ?? null,
      };
    }),
  };
}

/** Whitelisted ORDER BY; rows without a value (no date / no runner-up) always come last. */
function orderBy(key: string, desc: boolean) {
  const d = desc ? sql`DESC` : sql`ASC`;
  switch (key) {
    case "date": return sql`captured_at IS NULL, captured_at ${d}, distance ASC`;
    case "size": return sql`(x2 - x1) * (y2 - y1) ${d}, distance ASC`;
    case "margin": return sql`second_distance IS NULL, (second_distance - distance) ${d}, distance ASC`;
    default: return sql`distance ${d}`;
  }
}

/** All faces of one unnamed group straight from Immich, enriched with stored suggestions. */
async function clusterFaces(ownerId: string, clusterId: string, sortKey: string, desc: boolean) {
  const r = await db.execute(sql`
    SELECT f.id::text AS "faceId", f."assetId"::text AS "assetId", f."personGroupId"::text AS "currentPersonId",
           f."imageWidth" AS w, f."imageHeight" AS h, f."boundingBoxX1" AS x1, f."boundingBoxY1" AS y1,
           f."boundingBoxX2" AS x2, f."boundingBoxY2" AS y2, a."localDateTime" AS ldt
    FROM asset_face f JOIN asset a ON a.id = f."assetId"
    WHERE f."personGroupId" = ${clusterId}::uuid AND f."ownerId" = ${ownerId}::uuid AND ${visibleFace("f")}`);
  const all = rowsOf(r);
  const sug = new Map<string, any>();
  if (all.length) {
    const ss = (await appDb.all(sql`SELECT face_id AS "faceId", suggested_person_id AS "suggestedPersonId", distance,
        second_person_id AS "secondPersonId", second_distance AS "secondDistance", status
      FROM face_suggestions WHERE owner_id = ${ownerId} AND current_person_id = ${clusterId}`)) as any[];
    ss.forEach((x) => sug.set(x.faceId, x));
  }
  const merged = all
    .map(({ ldt, ...f }) => {
      const s = sug.get(f.faceId);
      if (s && s.status !== "open" && s.status !== "excluded") return null; // stranger / applied / deleted
      return {
        ...f, capturedAt: ldt ? new Date(ldt).toISOString() : null,
        suggestedPersonId: s?.suggestedPersonId || null, distance: s && s.distance < 90 ? s.distance : null,
        excluded: s?.status === "excluded",
        secondPersonId: s?.secondPersonId ?? null, secondDistance: s?.secondDistance ?? null,
      };
    })
    .filter(Boolean) as any[];
  const area = (f: any) => (f.x2 - f.x1) * (f.y2 - f.y1);
  const val = (f: any): number | null =>
    sortKey === "date" ? (f.capturedAt ? Date.parse(f.capturedAt) : null)
    : sortKey === "size" ? area(f)
    : sortKey === "margin" ? (f.secondDistance != null && f.distance != null ? f.secondDistance - f.distance : null)
    : f.distance;
  merged.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // missing values always last
    if (vb == null) return -1;
    return desc ? vb - va : va - vb;
  });
  return merged;
}

/**
 * Open suggestions for a person, or (clusterId) all faces of one unnamed group.
 * dateMode is relative to the person's birth date; 1970 / Jan 1 count as placeholder dates.
 * origin: group = faces from unnamed groups, loose = loose faces incl. faces excluded from a group.
 */
export async function listFaceSuggestions(ownerId: string, q: IFaceSuggestionsQuery): Promise<IFaceSuggestionsResponse> {
  const sortKey = ["distance", "date", "size", "margin"].includes(String(q.sort)) ? String(q.sort) : "distance";
  const desc = q.dir === "desc";

  let birth: string | null = null;
  if (q.personId) {
    const r0 = await db.execute(sql`SELECT "birthDate"::text AS b FROM person
      WHERE "ownerId" = ${ownerId}::uuid AND "personGroupId" = ${q.personId}::uuid`);
    birth = (rowsOf(r0)[0]?.b as string) || null;
  }

  let faces: any[] = [];
  let total = 0;
  let cluster: { exists: boolean; name: string } | null = null;
  if (q.clusterId) {
    const c = await db.execute(sql`SELECT name FROM person WHERE "ownerId" = ${ownerId}::uuid AND "personGroupId" = ${q.clusterId}::uuid`);
    const cr = rowsOf(c)[0];
    cluster = { exists: !!cr, name: cr?.name ?? "" };
    const merged = await clusterFaces(ownerId, q.clusterId, sortKey, desc);
    total = merged.length;
    faces = merged.slice(q.offset, q.offset + q.limit);
  } else {
    const placeholder = sql`(captured_at LIKE '1970-%' OR captured_at LIKE '%-01-01T%')`;
    let dateFilter = sql``;
    if (birth && q.dateMode === "hidePre") dateFilter = sql`AND (captured_at IS NULL OR captured_at >= ${birth} OR ${placeholder})`;
    else if (birth && q.dateMode === "onlyPre") dateFilter = sql`AND (captured_at < ${birth} OR ${placeholder})`;
    // "loose" = faces without group plus faces excluded from a group (they belong to single-face review).
    const originFilter = q.origin === "group" ? sql`AND current_person_id IS NOT NULL AND status = 'open'`
      : q.origin === "loose" ? sql`AND (current_person_id IS NULL OR status = 'excluded')` : sql``;
    const where = sql`owner_id = ${ownerId} AND status IN ('open', 'excluded') AND suggested_person_id = ${q.personId} ${dateFilter} ${originFilter}`;
    total = Number((((await appDb.all(sql`SELECT count(*) AS n FROM face_suggestions WHERE ${where}`)) as any[])[0]?.n) ?? 0);
    faces = (await appDb.all(sql`SELECT ${FACE_COLS} FROM face_suggestions WHERE ${where}
      ORDER BY ${orderBy(sortKey, desc)} LIMIT ${q.limit} OFFSET ${q.offset}`)) as any[];
  }

  // Group info for every group on this page: size (from Immich) and open-suggestion breakdown.
  const groupIds = Array.from(new Set(faces.map((f) => f.currentPersonId).filter(Boolean))) as string[];
  const groups: Record<string, IFaceGroupInfo> = {};
  (await groupSizes(ownerId, groupIds)).forEach((n, id) => { groups[id] = { size: n, breakdown: [] }; });
  (await breakdown(ownerId, groupIds)).forEach((x) => {
    (groups[x.cid] ??= { size: 0, breakdown: [] }).breakdown.push({ personId: x.pid, n: Number(x.n) });
  });

  const names = await personNames(ownerId, [
    ...faces.flatMap((f) => [f.suggestedPersonId, f.secondPersonId]),
    ...Object.values(groups).flatMap((g) => g.breakdown.map((x) => x.personId)),
  ]);

  return {
    birthDate: birth,
    total,
    cluster,
    names,
    groups,
    faces: faces.map((f) => ({
      ...f,
      suggestedName: f.suggestedPersonId ? names[f.suggestedPersonId] || null : null,
      secondName: f.secondPersonId ? names[f.secondPersonId] || null : null,
    })),
  };
}

/** All named people of the user (for the "Assign to…" picker), sorted by name. */
export async function listNamedPeople(ownerId: string): Promise<IFacesNamedPerson[]> {
  const r = await db.execute(sql`
    SELECT "personGroupId"::text AS id, name, "isHidden" AS hidden FROM person
    WHERE "ownerId" = ${ownerId}::uuid AND name <> ''
    ORDER BY lower(name)`);
  return rowsOf(r);
}

/** Audit log of the user, newest first, with person names resolved. */
export async function listFaceLog(ownerId: string, limit: number): Promise<IFaceLogRow[]> {
  const rows = (await appDb.all(sql`SELECT id, ts, user_id AS "userId", user_name AS "userName", action, face_id AS "faceId",
      asset_id AS "assetId", from_person_id AS "fromPersonId", to_person_id AS "toPersonId", distance, ok, error,
      undone_at AS "undoneAt"
    FROM face_review_log WHERE user_id = ${ownerId} ORDER BY id DESC LIMIT ${limit}`)) as any[];
  const names = await personNames(ownerId, rows.flatMap((r) => [r.fromPersonId, r.toPersonId]));
  return rows.map((r) => ({
    ...r,
    fromName: r.fromPersonId ? names[r.fromPersonId] || "(unnamed)" : null,
    toName: r.toPersonId ? names[r.toPersonId] || "(unnamed)" : null,
  }));
}
