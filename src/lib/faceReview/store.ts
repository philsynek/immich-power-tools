import { sql } from "drizzle-orm";
import { appDb } from "@/db";

let ready: Promise<void> | null = null;

/** Creates the face-review tables in the app SQLite DB (idempotent). */
export function ensureFaceReviewTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      // WAL + NORMAL: far fewer fsyncs. libsql's local driver is synchronous, so slow
      // commits on spinning disks would block the whole Node process.
      await appDb.run(sql`PRAGMA journal_mode = WAL`);
      await appDb.run(sql`PRAGMA synchronous = NORMAL`);
      await appDb.run(sql`CREATE TABLE IF NOT EXISTS face_suggestion (
        faceId TEXT PRIMARY KEY,
        assetId TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        suggestedPersonId TEXT NOT NULL,
        distance REAL NOT NULL,
        secondPersonId TEXT,
        secondDistance REAL,
        currentPersonId TEXT,
        capturedAt TEXT,
        imageWidth INTEGER, imageHeight INTEGER,
        x1 INTEGER, y1 INTEGER, x2 INTEGER, y2 INTEGER,
        status TEXT NOT NULL DEFAULT 'open',
        scannedAt TEXT NOT NULL
      )`);
      await appDb.run(sql`CREATE INDEX IF NOT EXISTS idx_fs_person ON face_suggestion(suggestedPersonId, status, distance)`);
      await appDb.run(sql`CREATE TABLE IF NOT EXISTS face_review_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        userId TEXT, userName TEXT,
        action TEXT NOT NULL,
        faceId TEXT NOT NULL, assetId TEXT,
        fromPersonId TEXT, toPersonId TEXT,
        distance REAL,
        ok INTEGER NOT NULL,
        error TEXT,
        undoneAt TEXT
      )`);
      await appDb.run(sql`CREATE TABLE IF NOT EXISTS face_scan_state (
        ownerId TEXT PRIMARY KEY,
        cursor TEXT, scanned INTEGER NOT NULL DEFAULT 0, stored INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0, updatedAt TEXT
      )`);
    })();
  }
  return ready;
}
