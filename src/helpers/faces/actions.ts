import { sql } from "drizzle-orm";
import { db } from "@/config/db";
import { appDb } from "@/db";
import { FacesUser, groupFaces, immich, keptOutOfGroup, liveFace, logAction, rowsOf } from "./common";
import { assignFace } from "./assign";
import { syncSuggestions } from "./sync";
import type { IFaceActionResult } from "@/types/faces";

const storedSuggestion = async (ownerId: string, faceId: string) =>
  ((await appDb.all(sql`SELECT asset_id AS "assetId", suggested_person_id AS "suggestedPersonId", current_person_id AS "currentPersonId",
      distance, status FROM face_suggestions WHERE face_id = ${faceId} AND owner_id = ${ownerId}`)) as any[])[0] as
    { assetId: string; suggestedPersonId: string; currentPersonId: string | null; distance: number; status: string } | undefined;

/** Placeholder row for a face without a stored suggestion, so group actions skip it. */
async function placeholder(ownerId: string, faceId: string, status: string) {
  const f = await liveFace(faceId);
  if (!f) return null;
  await appDb.run(sql`INSERT OR IGNORE INTO face_suggestions
    (face_id, asset_id, owner_id, suggested_person_id, distance, current_person_id, status, scanned_at)
    VALUES (${faceId}, ${f.assetId}, ${ownerId}, '', 99, ${f.personId}, ${status}, ${new Date().toISOString()})`);
  return f;
}

/** Assigns faces to their suggested person (or to `personId` for all of them). */
export async function applyFaces(user: FacesUser, faceIds: string[], personId?: string) {
  const results: IFaceActionResult[] = [];
  for (const faceId of faceIds) results.push(await assignFace(user, faceId, personId));
  return { results };
}

/**
 * Assigns every face of the given unnamed groups to personId. Faces the user kept out
 * (stranger / excluded / hidden) are skipped. One by one, so each assignment can be undone from the log.
 */
export async function applyGroups(user: FacesUser, clusterIds: string[], personId: string) {
  const results: IFaceActionResult[] = [];
  let skipped = 0;
  for (const clusterId of clusterIds) {
    const faces = await groupFaces(user.id, clusterId);
    const skip = await keptOutOfGroup(user.id, clusterId);
    for (const f of faces) {
      if (skip.has(f.id)) { skipped++; continue; }
      results.push(await assignFace(user, f.id, personId));
    }
  }
  await syncSuggestions(user.id, true);
  return { results, skipped };
}

/** "Stranger" for single faces: tool-only, Immich is not touched. */
export async function rejectFaces(user: FacesUser, faceIds: string[]) {
  const logIds: number[] = [];
  for (const faceId of faceIds) {
    const s = await storedSuggestion(user.id, faceId);
    let id: number | null;
    if (!s) {
      // Face without a stored suggestion (e.g. shown in the group detail view).
      const f = await placeholder(user.id, faceId, "rejected");
      if (!f) continue;
      id = await logAction(user, { action: "reject", faceId, assetId: f.assetId, ok: true });
    } else {
      await appDb.run(sql`UPDATE face_suggestions SET status = 'rejected' WHERE face_id = ${faceId}`);
      id = await logAction(user, { action: "reject", faceId, assetId: s.assetId, toPersonId: s.suggestedPersonId, distance: s.distance, ok: true });
    }
    if (id) logIds.push(id);
  }
  return { ok: true, logIds };
}

/**
 * Excludes faces from group actions, or takes them back (include=true). Tool-only.
 * The UI only offers "Include again" for faces excluded by earlier versions.
 */
export async function excludeFaces(user: FacesUser, faceIds: string[], include: boolean) {
  for (const faceId of faceIds) {
    const s = await storedSuggestion(user.id, faceId);
    if (include) {
      if (s?.status !== "excluded") continue;
      await appDb.run(sql`UPDATE face_suggestions SET status = 'open' WHERE face_id = ${faceId}`);
    } else if (s) {
      if (s.status !== "open") continue;
      await appDb.run(sql`UPDATE face_suggestions SET status = 'excluded' WHERE face_id = ${faceId}`);
    } else if (!(await placeholder(user.id, faceId, "excluded"))) continue;
    await logAction(user, { action: include ? "include" : "exclude", faceId, assetId: s?.assetId ?? null, ok: true });
  }
  return { ok: true };
}

/**
 * "No face": soft-deletes face detections in Immich (DELETE /faces/{id}, force=false). The photo is untouched.
 * Immich has no API to restore a deleted detection, so this cannot be undone from the tool.
 */
export async function deleteFaces(user: FacesUser, faceIds: string[]) {
  const results: IFaceActionResult[] = [];
  for (const faceId of faceIds) {
    const s = await storedSuggestion(user.id, faceId);
    let assetId = s?.assetId, fromPersonId = s?.currentPersonId ?? null;
    if (!s) {
      const f = await liveFace(faceId);
      if (!f) { results.push({ faceId, ok: false, error: "face not found" }); continue; }
      assetId = f.assetId; fromPersonId = f.personId;
    }
    const r = await immich(user, "DELETE", `/faces/${faceId}`, { force: false });
    await logAction(user, { action: "delete", faceId, assetId, fromPersonId, distance: s?.distance ?? null, ok: r.ok, error: r.error });
    if (r.ok && s) await appDb.run(sql`UPDATE face_suggestions SET status = 'deleted' WHERE face_id = ${faceId}`);
    results.push({ faceId, ok: r.ok, error: r.error ?? undefined });
  }
  return { results };
}

/** "No face" for a whole unnamed group. Faces the user kept out of the group are kept. */
export async function deleteGroup(user: FacesUser, clusterId: string) {
  const faces = await groupFaces(user.id, clusterId);
  const keep = await keptOutOfGroup(user.id, clusterId);
  let deleted = 0, skipped = 0;
  const errors: string[] = [];
  for (const f of faces) {
    if (keep.has(f.id)) { skipped++; continue; }
    const r = await immich(user, "DELETE", `/faces/${f.id}`, { force: false });
    await logAction(user, { action: "delete", faceId: f.id, assetId: f.assetId, fromPersonId: clusterId, ok: r.ok, error: r.error });
    if (r.ok) { deleted++; await appDb.run(sql`UPDATE face_suggestions SET status = 'deleted' WHERE face_id = ${f.id}`); }
    else if (r.error) errors.push(r.error);
  }
  return { deleted, skipped, errors: errors.length, error: errors[0] ?? null };
}

/**
 * "Stranger" for an unnamed group: hides the person in Immich (PUT /people/{id} { isHidden: true })
 * and marks its open suggestions 'hidden' (they survive a rescan). Undo via the log reverts both.
 */
export async function hideGroup(user: FacesUser, clusterId: string) {
  const r = await immich(user, "PUT", `/people/${clusterId}`, { isHidden: true });
  if (r.ok) {
    await appDb.run(sql`UPDATE face_suggestions SET status = 'hidden'
      WHERE owner_id = ${user.id} AND current_person_id = ${clusterId} AND status IN ('open', 'excluded')`);
  }
  const logId = await logAction(user, { action: "hide-group", faceId: clusterId, fromPersonId: clusterId, ok: r.ok, error: r.error });
  return { status: r.ok ? 200 : 502, body: { ok: r.ok, error: r.error, logId } };
}

/** Names an unnamed group in Immich (PUT /people/{id} { name }). Undo clears the name again. */
export async function nameGroup(user: FacesUser, clusterId: string, name: string) {
  const r = await immich(user, "PUT", `/people/${clusterId}`, { name });
  const logId = await logAction(user, { action: "name-group", faceId: clusterId, toPersonId: clusterId, ok: r.ok, error: r.error });
  if (r.ok) await syncSuggestions(user.id, true);
  return { status: r.ok ? 200 : 502, body: { ok: r.ok, error: r.error, logId } };
}

/** Creates a named person in Immich (POST /people) and assigns the face to it. Undo moves the face back. */
export async function newPerson(user: FacesUser, faceId: string, name: string) {
  const c = await immich(user, "POST", "/people", { name });
  if (!c.ok) return { status: 502, body: { ok: false, error: `create person: ${c.error}` } };
  const result = await assignFace(user, faceId, c.data.id);
  return { status: result.ok ? 200 : 502, body: { ...result, personId: c.data.id } };
}

const UNDOABLE = ["assign", "hide-group", "name-group", "reject"];

async function undoOne(user: FacesUser, logId: number): Promise<{ logId: number; ok: boolean; error?: string; note?: string }> {
  const row = ((await appDb.all(sql`SELECT id, action, face_id AS "faceId", asset_id AS "assetId", from_person_id AS "fromPersonId",
      to_person_id AS "toPersonId", distance, ok, undone_at AS "undoneAt"
    FROM face_review_log WHERE id = ${logId} AND user_id = ${user.id}`)) as any[])[0];
  if (!row || !row.ok || row.undoneAt || !UNDOABLE.includes(row.action)) return { logId, ok: false, error: "cannot be undone" };
  const now = new Date().toISOString();
  const markUndone = () => appDb.run(sql`UPDATE face_review_log SET undone_at = ${now} WHERE id = ${row.id}`);

  if (row.action === "reject") {
    // Single-face "Stranger" is tool-only: just reopen the suggestion.
    await appDb.run(sql`UPDATE face_suggestions SET status = 'open' WHERE face_id = ${row.faceId} AND owner_id = ${user.id} AND status = 'rejected'`);
    await markUndone();
    await logAction(user, { action: "undo", faceId: row.faceId, assetId: row.assetId, ok: true }, now);
    return { logId, ok: true };
  }

  if (row.action === "name-group" || row.action === "hide-group") {
    const naming = row.action === "name-group";
    const r = await immich(user, "PUT", `/people/${row.faceId}`, naming ? { name: "" } : { isHidden: false });
    await logAction(user, { action: "undo", faceId: row.faceId, fromPersonId: row.faceId, ok: r.ok, error: r.error }, now);
    if (r.ok) {
      await markUndone();
      await appDb.run(sql`UPDATE face_suggestions SET status = 'open'
        WHERE owner_id = ${user.id} AND current_person_id = ${row.faceId} AND status = ${naming ? "resolved" : "hidden"}`);
    }
    return { logId, ok: r.ok, error: r.error ?? undefined };
  }

  // assign: move the face back to its previous person. If it had none, move it to a fresh unnamed
  // person instead (the API cannot un-assign; Immich's clustering may merge it again later).
  // If the previous group/person no longer exists in Immich (e.g. removed by Immich's cleanup of people
  // without faces), it is not recreated: the face comes back as a loose face instead.
  let target: string | null = row.fromPersonId;
  let note: string | undefined;
  if (target) {
    const p = await db.execute(sql`SELECT 1 FROM person WHERE "ownerId" = ${user.id}::uuid AND "personGroupId" = ${target}::uuid`);
    if (!rowsOf(p).length) { target = null; note = "original group no longer exists, back as a loose face"; }
  }
  const loose = !target;
  if (!target) {
    const c = await immich(user, "POST", "/people", {});
    if (!c.ok) return { logId, ok: false, error: `create person: ${c.error}` };
    target = c.data.id as string;
  }
  const r = await immich(user, "PUT", `/faces/${target}`, { id: row.faceId });
  await logAction(user, {
    action: "undo", faceId: row.faceId, assetId: row.assetId, fromPersonId: row.toPersonId, toPersonId: target,
    distance: row.distance, ok: r.ok, error: r.error ?? note ?? null,
  }, now);
  if (r.ok) {
    await markUndone();
    await appDb.run(sql`UPDATE face_suggestions SET status = 'open', current_person_id = ${loose ? null : target}
      WHERE face_id = ${row.faceId}`);
  }
  return { logId, ok: r.ok, error: r.error ?? undefined, note };
}

/** Reverts assignments, single-face strangers, hidden and named groups. */
export async function undoActions(user: FacesUser, logIds: number[]) {
  const results = [];
  for (const id of logIds) results.push(await undoOne(user, id));
  const bad = results.filter((r) => !r.ok);
  return { results, ok: !bad.length, error: bad[0]?.error };
}
