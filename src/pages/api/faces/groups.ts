import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";
import { syncSuggestions } from "@/lib/faceReview/sync";
import { majoritySql } from "@/lib/faceReview/groups";

const rowsOf = (r: any): any[] => (r as any).rows ?? r;

/**
 * GET /api/faces/groups?personId=&limit=&offset=
 * Unnamed groups whose majority suggestion is personId.
 * sort=size|share|best (best = closest face), dir=asc|desc.
 * Each group carries a representative face (closest face suggesting personId) and the suggestion breakdown.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  await syncSuggestions(user.id, req.query.sync === "1");
  const personId = String(req.query.personId || "");
  if (!personId) return res.status(400).json({ message: "personId required" });
  const limit = Math.min(parseInt(String(req.query.limit || "100"), 10) || 100, 500);
  const offset = parseInt(String(req.query.offset || "0"), 10) || 0;

  const all = (await appDb.all(sql`SELECT cid, n, tot, md FROM (${majoritySql(user.id)}) WHERE pid = ${personId}`)) as any[];
  if (!all.length) return res.status(200).json({ total: 0, groups: [], names: {} });
  // Current group sizes straight from Immich (assigned faces have left the group already).
  const sz = await db.execute(sql`SELECT f."personId"::text AS id, count(*)::int AS n FROM asset_face f
    JOIN asset a ON a.id = f."assetId"
    WHERE f."personId" IN (${sql.join(all.map((g) => sql`${g.cid}::uuid`), sql`, `)}) AND f."deletedAt" IS NULL
      AND a."deletedAt" IS NULL AND a.visibility <> 'locked'
    GROUP BY f."personId"`);
  const sizeBy = new Map(rowsOf(sz).map((x) => [x.id, Number(x.n)]));
  const nm = await db.execute(sql`SELECT id::text AS id FROM person
    WHERE id IN (${sql.join(all.map((g) => sql`${g.cid}::uuid`), sql`, `)}) AND name = ''`);
  const stillUnnamed = new Set(rowsOf(nm).map((x) => x.id));
  for (let i = all.length - 1; i >= 0; i--) if (!stillUnnamed.has(all[i].cid)) all.splice(i, 1);
  const sortKey = ["size", "share", "best"].includes(String(req.query.sort)) ? String(req.query.sort) : "size";
  const sign = String(req.query.dir) === "asc" ? 1 : -1;
  const size = (g: any) => sizeBy.get(g.cid) ?? Number(g.tot);
  const key = (g: any) => (sortKey === "share" ? g.n / g.tot : sortKey === "best" ? g.md : size(g));
  all.sort((a, b) => sign * (key(a) - key(b)) || size(b) - size(a));
  const page = all.slice(offset, offset + limit);
  const cids = page.map((g) => g.cid as string);
  if (!cids.length) return res.status(200).json({ total: all.length, groups: [], names: {} });
  const cidList = sql.join(cids.map((c) => sql`${c}`), sql`, `);

  // Representative face per group: the closest face that suggests personId.
  const reps = (await appDb.all(sql`
    SELECT * FROM (
      SELECT currentPersonId AS cid, faceId, assetId, distance, capturedAt,
             imageWidth AS w, imageHeight AS h, x1, y1, x2, y2,
             row_number() OVER (PARTITION BY currentPersonId ORDER BY distance) AS rk
      FROM face_suggestion
      WHERE ownerId = ${user.id} AND status = 'open' AND suggestedPersonId = ${personId} AND currentPersonId IN (${cidList})
    ) WHERE rk = 1`)) as any[];
  const repBy = new Map(reps.map((r) => [r.cid, r]));
  const bd = (await appDb.all(sql`
    SELECT currentPersonId AS cid, suggestedPersonId AS pid, count(*) AS n FROM face_suggestion
    WHERE ownerId = ${user.id} AND status = 'open' AND suggestedPersonId <> '' AND currentPersonId IN (${cidList})
    GROUP BY currentPersonId, suggestedPersonId ORDER BY n DESC`)) as any[];
  const ex = (await appDb.all(sql`
    SELECT currentPersonId AS cid, count(*) AS n FROM face_suggestion
    WHERE ownerId = ${user.id} AND status IN ('excluded', 'rejected') AND currentPersonId IN (${cidList})
    GROUP BY currentPersonId`)) as any[];
  const exBy = new Map(ex.map((x) => [x.cid, Number(x.n)]));

  const pids = Array.from(new Set([personId, ...bd.map((x) => x.pid)]));
  const nr = await db.execute(sql`SELECT id::text AS id, name FROM person WHERE id IN (${sql.join(pids.map((p) => sql`${p}::uuid`), sql`, `)})`);
  const names: Record<string, string> = {};
  rowsOf(nr).forEach((p) => { names[p.id] = p.name; });

  return res.status(200).json({
    total: all.length,
    names,
    groups: page.map((g) => {
      const size = sizeBy.get(g.cid) ?? Number(g.tot);
      const excluded = exBy.get(g.cid) ?? 0;
      return {
      clusterId: g.cid,
      size,
      majority: Number(g.n),
      withSuggestion: Number(g.tot),
      excluded,
      noSuggestion: Math.max(0, size - Number(g.tot) - excluded),
      breakdown: bd.filter((x) => x.cid === g.cid).map((x) => ({ personId: x.pid, n: Number(x.n) })),
      rep: repBy.get(g.cid) ?? null,
      };
    }),
  });
}
