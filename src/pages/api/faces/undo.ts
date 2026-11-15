import type { NextApiRequest, NextApiResponse } from "next";
import { sql } from "drizzle-orm";
import { appDb } from "@/db";
import { ENV } from "@/config/environment";
import { getCurrentUser } from "@/handlers/serverUtils/user.utils";
import { getUserHeaders } from "@/helpers/user.helper";
import { ensureFaceReviewTables } from "@/lib/faceReview/store";

interface UndoResult { logId: number; ok: boolean; error?: string }

async function undoOne(user: any, logId: number): Promise<UndoResult> {
  const row = ((await appDb.all(sql`SELECT * FROM face_review_log WHERE id = ${logId} AND userId = ${user.id}`)) as any[])[0];
  if (!row || !row.ok || row.undoneAt || !["assign", "hide-group", "name-group", "reject"].includes(row.action)) return { logId, ok: false, error: "cannot be undone" };
  const now = new Date().toISOString();

  if (row.action === "reject") {
    // "Stranger" for a single face is tool-only: just reopen the suggestion.
    await appDb.run(sql`UPDATE face_suggestion SET status = 'open' WHERE faceId = ${row.faceId} AND ownerId = ${user.id} AND status = 'rejected'`);
    await appDb.run(sql`UPDATE face_review_log SET undoneAt = ${now} WHERE id = ${row.id}`);
    await appDb.run(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, assetId, ok)
      VALUES (${now}, ${user.id}, ${user.name ?? null}, 'undo', ${row.faceId}, ${row.assetId}, 1)`);
    return { logId, ok: true };
  }

  if (row.action === "name-group") {
    // Clear the name again: the person becomes an unnamed group; its suggestions come back.
    const r = await fetch(`${ENV.IMMICH_URL}/api/people/${row.faceId}`, {
      method: "PUT", headers: getUserHeaders(user), body: JSON.stringify({ name: "" }),
    });
    const ok = r.ok;
    const error = ok ? undefined : `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
    await appDb.run(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, fromPersonId, ok, error)
      VALUES (${now}, ${user.id}, ${user.name ?? null}, 'undo', ${row.faceId}, ${row.faceId}, ${ok ? 1 : 0}, ${error ?? null})`);
    if (ok) {
      await appDb.run(sql`UPDATE face_review_log SET undoneAt = ${now} WHERE id = ${row.id}`);
      await appDb.run(sql`UPDATE face_suggestion SET status = 'open' WHERE ownerId = ${user.id} AND currentPersonId = ${row.faceId} AND status = 'resolved'`);
    }
    return { logId, ok, error };
  }

  if (row.action === "hide-group") {
    const r = await fetch(`${ENV.IMMICH_URL}/api/people/${row.faceId}`, {
      method: "PUT", headers: getUserHeaders(user), body: JSON.stringify({ isHidden: false }),
    });
    const ok = r.ok;
    const error = ok ? undefined : `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
    await appDb.run(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, fromPersonId, ok, error)
      VALUES (${now}, ${user.id}, ${user.name ?? null}, 'undo', ${row.faceId}, ${row.faceId}, ${ok ? 1 : 0}, ${error ?? null})`);
    if (ok) {
      await appDb.run(sql`UPDATE face_review_log SET undoneAt = ${now} WHERE id = ${row.id}`);
      await appDb.run(sql`UPDATE face_suggestion SET status = 'open' WHERE ownerId = ${user.id} AND currentPersonId = ${row.faceId} AND status = 'hidden'`);
    }
    return { logId, ok, error };
  }

  // assign: move the face back to its previous person. If it had none, move it to a fresh unnamed
  // person instead (the API cannot un-assign; Immich's clustering may merge it again later).
  let target: string = row.fromPersonId;
  if (!target) {
    const c = await fetch(`${ENV.IMMICH_URL}/api/people`, { method: "POST", headers: getUserHeaders(user), body: JSON.stringify({}) });
    if (!c.ok) return { logId, ok: false, error: `create person: HTTP ${c.status} ${(await c.text()).slice(0, 200)}` };
    target = (await c.json()).id;
  }
  // Immich: PUT /faces/{personId} with body { id: faceId }.
  const r = await fetch(`${ENV.IMMICH_URL}/api/faces/${target}`, {
    method: "PUT", headers: getUserHeaders(user), body: JSON.stringify({ id: row.faceId }),
  });
  const ok = r.ok;
  const error = ok ? undefined : `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
  await appDb.run(sql`INSERT INTO face_review_log (ts, userId, userName, action, faceId, assetId, fromPersonId, toPersonId, distance, ok, error)
    VALUES (${now}, ${user.id}, ${user.name ?? null}, 'undo', ${row.faceId}, ${row.assetId}, ${row.toPersonId}, ${target}, ${row.distance}, ${ok ? 1 : 0}, ${error ?? null})`);
  if (ok) {
    await appDb.run(sql`UPDATE face_review_log SET undoneAt = ${now} WHERE id = ${row.id}`);
    await appDb.run(sql`UPDATE face_suggestion SET status = 'open', currentPersonId = ${row.fromPersonId ? target : null} WHERE faceId = ${row.faceId}`);
  }
  return { logId, ok, error };
}

/** POST { logId } or { logIds: number[] } – reverts assignments and hidden groups. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });
  const user = await getCurrentUser(req);
  if (!user) return res.status(403).json({ message: "Unauthorized" });
  await ensureFaceReviewTables();
  const ids: number[] = (Array.isArray(req.body?.logIds) ? req.body.logIds : [req.body?.logId]).map(Number).filter(Boolean).slice(0, 500);
  const results: UndoResult[] = [];
  for (const id of ids) results.push(await undoOne(user, id));
  const bad = results.filter((r) => !r.ok);
  return res.status(200).json({ results, ok: !bad.length, error: bad[0]?.error });
}
