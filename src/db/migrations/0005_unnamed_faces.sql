-- Unnamed Faces tables (snake_case). Earlier development builds created camelCase tables
-- (face_suggestion, face_review_log, face_scan_state) at runtime; their data is copied over here.
-- On a fresh install the "old" tables are created empty, so the copy is a no-op.
CREATE TABLE IF NOT EXISTS `face_suggestion` (
	`faceId` text PRIMARY KEY, `assetId` text NOT NULL, `ownerId` text NOT NULL, `suggestedPersonId` text NOT NULL,
	`distance` real NOT NULL, `secondPersonId` text, `secondDistance` real, `currentPersonId` text, `capturedAt` text,
	`imageWidth` integer, `imageHeight` integer, `x1` integer, `y1` integer, `x2` integer, `y2` integer,
	`status` text NOT NULL DEFAULT 'open', `scannedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `face_review_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT, `ts` text NOT NULL, `userId` text, `userName` text, `action` text NOT NULL,
	`faceId` text NOT NULL, `assetId` text, `fromPersonId` text, `toPersonId` text, `distance` real,
	`ok` integer NOT NULL, `error` text, `undoneAt` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `face_scan_state` (
	`ownerId` text PRIMARY KEY, `cursor` text, `scanned` integer NOT NULL DEFAULT 0, `stored` integer NOT NULL DEFAULT 0,
	`done` integer NOT NULL DEFAULT 0, `updatedAt` text
);
--> statement-breakpoint
ALTER TABLE `face_review_log` RENAME TO `__old_face_review_log`;
--> statement-breakpoint
ALTER TABLE `face_scan_state` RENAME TO `__old_face_scan_state`;
--> statement-breakpoint
CREATE TABLE `face_suggestions` (
	`face_id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`suggested_person_id` text NOT NULL,
	`distance` real NOT NULL,
	`second_person_id` text,
	`second_distance` real,
	`current_person_id` text,
	`captured_at` text,
	`image_width` integer,
	`image_height` integer,
	`x1` integer,
	`y1` integer,
	`x2` integer,
	`y2` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`scanned_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `face_suggestions_person_idx` ON `face_suggestions` (`suggested_person_id`,`status`,`distance`);
--> statement-breakpoint
CREATE INDEX `face_suggestions_current_idx` ON `face_suggestions` (`current_person_id`);
--> statement-breakpoint
CREATE TABLE `face_review_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`user_id` text,
	`user_name` text,
	`action` text NOT NULL,
	`face_id` text NOT NULL,
	`asset_id` text,
	`from_person_id` text,
	`to_person_id` text,
	`distance` real,
	`ok` integer NOT NULL,
	`error` text,
	`undone_at` text
);
--> statement-breakpoint
CREATE TABLE `face_scan_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`scanned` integer DEFAULT 0 NOT NULL,
	`stored` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
INSERT INTO `face_suggestions` (`face_id`, `asset_id`, `owner_id`, `suggested_person_id`, `distance`, `second_person_id`, `second_distance`, `current_person_id`, `captured_at`, `image_width`, `image_height`, `x1`, `y1`, `x2`, `y2`, `status`, `scanned_at`)
	SELECT `faceId`, `assetId`, `ownerId`, `suggestedPersonId`, `distance`, `secondPersonId`, `secondDistance`, `currentPersonId`, `capturedAt`, `imageWidth`, `imageHeight`, `x1`, `y1`, `x2`, `y2`, `status`, `scannedAt` FROM `face_suggestion`;
--> statement-breakpoint
INSERT INTO `face_review_log` (`id`, `ts`, `user_id`, `user_name`, `action`, `face_id`, `asset_id`, `from_person_id`, `to_person_id`, `distance`, `ok`, `error`, `undone_at`)
	SELECT `id`, `ts`, `userId`, `userName`, `action`, `faceId`, `assetId`, `fromPersonId`, `toPersonId`, `distance`, `ok`, `error`, `undoneAt` FROM `__old_face_review_log`;
--> statement-breakpoint
INSERT INTO `face_scan_state` (`owner_id`, `cursor`, `scanned`, `stored`, `done`, `updated_at`)
	SELECT `ownerId`, `cursor`, `scanned`, `stored`, `done`, `updatedAt` FROM `__old_face_scan_state`;
--> statement-breakpoint
DROP TABLE `face_suggestion`;
--> statement-breakpoint
DROP TABLE `__old_face_review_log`;
--> statement-breakpoint
DROP TABLE `__old_face_scan_state`;
