import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

/**
 * Unnamed Faces: one row per scanned face without a named person.
 * status: open | applied | rejected | excluded | hidden | deleted | resolved | unavailable
 */
export const faceSuggestions = sqliteTable("face_suggestions", {
  faceId: text("face_id").primaryKey(),
  assetId: text("asset_id").notNull(),
  ownerId: text("owner_id").notNull(),
  suggestedPersonId: text("suggested_person_id").notNull(),
  distance: real("distance").notNull(),
  secondPersonId: text("second_person_id"),
  secondDistance: real("second_distance"),
  currentPersonId: text("current_person_id"),
  capturedAt: text("captured_at"),
  imageWidth: integer("image_width"),
  imageHeight: integer("image_height"),
  x1: integer("x1"),
  y1: integer("y1"),
  x2: integer("x2"),
  y2: integer("y2"),
  status: text("status").notNull().default("open"),
  scannedAt: text("scanned_at").notNull(),
}, (t) => [
  index("face_suggestions_person_idx").on(t.suggestedPersonId, t.status, t.distance),
  index("face_suggestions_current_idx").on(t.currentPersonId),
]);

/** Audit log of every action taken in Unnamed Faces (assign, reject, delete, undo, …). */
export const faceReviewLog = sqliteTable("face_review_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: text("ts").notNull(),
  userId: text("user_id"),
  userName: text("user_name"),
  action: text("action").notNull(),
  faceId: text("face_id").notNull(),
  assetId: text("asset_id"),
  fromPersonId: text("from_person_id"),
  toPersonId: text("to_person_id"),
  distance: real("distance"),
  ok: integer("ok").notNull(),
  error: text("error"),
  undoneAt: text("undone_at"),
});

/** Scan progress per user (resumable). */
export const faceScanState = sqliteTable("face_scan_state", {
  ownerId: text("owner_id").primaryKey(),
  cursor: text("cursor"),
  scanned: integer("scanned").notNull().default(0),
  stored: integer("stored").notNull().default(0),
  done: integer("done").notNull().default(0),
  updatedAt: text("updated_at"),
});
