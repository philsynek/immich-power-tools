import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";
import { syncSuggestions } from "@/lib/faceReview/sync";

const rowsOf = (r: any): any[] => (r as any).rows ?? r;

/** Whitelisted ORDER BY; rows without a value (no date / no runner-up) always come last. */
function orderBy(key: string, desc: boolean) {
  const d = desc ? sql`DESC` : sql`ASC`;
  switch (key) {
    case "date": return sql`capturedAt IS NULL, capturedAt ${d}, distance ASC`;
    case "size": return sql`(x2 - x1) * (y2 - y1) ${d}, distance ASC`;
    case "margin": return sql`secondDistance IS NULL, (secondDistance - distance) ${d}, distance ASC`;
    default: return sql`distance ${d}`;
  }
}
const uuidList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

/**
 * GET /api/faces/suggestions
 *   personId=…            open suggestions for this person (sorted by distance)
 *   clusterId=…           instead: ALL faces of this unnamed group (incl. faces without/with other suggestions)
 *   dateMode=all|hidePre|onlyPre   relative to the birth date of personId; 1970 / 01-01 count as placeholder dates
 *   origin=all|group|loose         only faces from unnamed groups / loose faces incl. faces thrown out of a group
 *   sort=distance|date|size|margin, dir=asc|desc   (size = face box area, margin = runner-up distance − distance)
 *   limit, offset
 * Response also carries `groups`: size and suggestion breakdown for every group seen in the page.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  await syncSuggestions(user.id, req.query.sync === "1");
  const personId = String(req.query.personId || "");
  const clusterId = String(req.query.clusterId || "");
  if (!personId && !clusterId) return res.status(400).json({ message: "personId or clusterId required" });
  const limit = Math.min(parseInt(String(req.query.limit || "200"), 10) || 200, 1000);
  const offset = parseInt(String(req.query.offset || "0"), 10) || 0;
  const dateMode = String(req.query.dateMode || "all");
  const origin = String(req.query.origin || "all");
  const sortKey = ["distance", "date", "size", "margin"].includes(String(req.query.sort)) ? String(req.query.sort) : "distance";
  const desc = String(req.query.dir) === "desc";

  let birth: string | null = null;
  if (personId) {
    const r0 = await db.execute(sql`SELECT "birthDate"::text AS b FROM person WHERE id = ${personId}::uuid`);
    birth = (rowsOf(r0)[0]?.b as string) || null;
  }

  let faces: any[] = [];
  let total = 0;
  let cluster: { exists: boolean; name: string } | null = null;
  if (clusterId) {
    const c = await db.execute(sql`SELECT name FROM person WHERE id = ${clusterId}::uuid`);
    const cr = rowsOf(c)[0];
    cluster = { exists: !!cr, name: cr?.name ?? "" };
    // All faces of the group straight from Immich, enriched with stored suggestions.
    const r = await db.execute(sql`
      SELECT f.id::text AS "faceId", f."assetId"::text AS "assetId", f."personId"::text AS "currentPersonId",
             f."imageWidth" AS w, f."imageHeight" AS h, f."boundingBoxX1" AS x1, f."boundingBoxY1" AS y1,
             f."boundingBoxX2" AS x2, f."boundingBoxY2" AS y2, a."localDateTime" AS ldt
      FROM asset_face f JOIN asset a ON a.id = f."assetId"
      WHERE f."personId" = ${clusterId}::uuid AND f."deletedAt" IS NULL AND a."deletedAt" IS NULL AND a.visibility <> 'locked'`);
    const all = rowsOf(r);
    const sug = new Map<string, any>();
    if (all.length) {
      const ss = (await appDb.all(sql`SELECT faceId, suggestedPersonId, distance, secondPersonId, secondDistance, status
        FROM face_suggestion WHERE ownerId = ${user.id} AND currentPersonId = ${clusterId}`)) as any[];
      ss.forEach((x) => sug.set(x.faceId, x));
    }
    const merged = all
      .map((f) => {
        const s = sug.get(f.faceId);
        if (s && s.status !== "open" && s.status !== "excluded") return null; // rejected / applied / deleted
        return {
          ...f, capturedAt: f.ldt ? new Date(f.ldt).toISOString() : null,
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
    total = merged.length;
    faces = merged.slice(offset, offset + limit);
  } else {
    const placeholder = sql`(capturedAt LIKE '1970-%' OR capturedAt LIKE '%-01-01T%')`;
    let dateFilter = sql``;
    if (birth && dateMode === "hidePre") dateFilter = sql`AND (capturedAt IS NULL OR capturedAt >= ${birth} OR ${placeholder})`;
    else if (birth && dateMode === "onlyPre") dateFilter = sql`AND (capturedAt < ${birth} OR ${placeholder})`;
    // "loose" = faces without group plus faces thrown out of a group (they belong to single-face review).
    const originFilter = origin === "group" ? sql`AND currentPersonId IS NOT NULL AND status = 'open'`
      : origin === "loose" ? sql`AND (currentPersonId IS NULL OR status = 'excluded')` : sql``;
    const where = sql`ownerId = ${user.id} AND status IN ('open', 'excluded') AND suggestedPersonId = ${personId} ${dateFilter} ${originFilter}`;
    total = Number((((await appDb.all(sql`SELECT count(*) AS n FROM face_suggestion WHERE ${where}`)) as any[])[0]?.n) ?? 0);
    faces = (await appDb.all(sql`
      SELECT faceId, assetId, suggestedPersonId, distance, status = 'excluded' AS excluded, secondPersonId, secondDistance, currentPersonId, capturedAt,
             imageWidth AS w, imageHeight AS h, x1, y1, x2, y2
      FROM face_suggestion WHERE ${where}
      ORDER BY ${orderBy(sortKey, desc)} LIMIT ${limit} OFFSET ${offset}`)) as any[];
  }

  // Group info for every group on this page: size (from Immich) and open-suggestion breakdown.
  const groupIds = Array.from(new Set(faces.map((f) => f.currentPersonId).filter(Boolean))) as string[];
  const groups: Record<string, { size: number; breakdown: { personId: string; n: number }[] }> = {};
  if (groupIds.length) {
    const r = await db.execute(sql`SELECT f."personId"::text AS id, count(*)::int AS n FROM asset_face f
      JOIN asset a ON a.id = f."assetId"
      WHERE f."personId" IN (${uuidList(groupIds)}) AND f."deletedAt" IS NULL AND a."deletedAt" IS NULL AND a.visibility <> 'locked'
      GROUP BY f."personId"`);
    rowsOf(r).forEach((x) => { groups[x.id] = { size: Number(x.n), breakdown: [] }; });
    const b = (await appDb.all(sql`SELECT currentPersonId AS g, suggestedPersonId AS p, count(*) AS n FROM face_suggestion
      WHERE ownerId = ${user.id} AND status = 'open' AND suggestedPersonId <> ''
        AND currentPersonId IN (${sql.join(groupIds.map((i) => sql`${i}`), sql`, `)})
      GROUP BY currentPersonId, suggestedPersonId ORDER BY n DESC`)) as any[];
    b.forEach((x) => { (groups[x.g] ??= { size: 0, breakdown: [] }).breakdown.push({ personId: x.p, n: Number(x.n) }); });
  }

  // Names for suggested / second / breakdown persons.
  const nameIds = Array.from(new Set([
    ...faces.flatMap((f) => [f.suggestedPersonId, f.secondPersonId]),
    ...Object.values(groups).flatMap((g) => g.breakdown.map((x) => x.personId)),
  ].filter(Boolean))) as string[];
  const names: Record<string, string> = {};
  if (nameIds.length) {
    const r = await db.execute(sql`SELECT id::text AS id, name FROM person WHERE id IN (${uuidList(nameIds)})`);
    rowsOf(r).forEach((p) => { names[p.id] = p.name; });
  }

  return res.status(200).json({
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
  });
}
