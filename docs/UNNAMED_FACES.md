# Unnamed Faces

Unnamed Faces helps you go through the faces Immich detected but never assigned to a named person:
loose faces and faces sitting in unnamed people ("clusters", called *groups* in the UI).
For every such face it looks up the most similar face of a **named** person and offers that person as
a suggestion. You confirm suggestions in bulk, group by group or face by face. Every change is logged
and (where Immich allows it) can be undone.

> Status: proof of concept. Built against Immich **v3.0.x** and ported to **v3.4** (`personGroupId` schema); used on a single-user library
> (~500k faces). See [Known limitations](#known-limitations).

## How it works

### Scan

1. Candidates: every face that is not deleted, belongs to the current user's assets and either has no
   person or belongs to a person without a name (hidden or visible). Photos in the trash and in the
   **locked folder are ignored** – they are never shown, and group actions never touch their faces.
2. For each candidate the scan asks the vector index (`face_search`, VectorChord) for the 100 nearest
   faces overall, then keeps only faces of **named** people and groups them by person.
3. The closest named person becomes the suggestion, the second closest the runner-up. Only matches
   with a cosine distance of **≤ 0.65** are stored.
4. Results go to the app's own SQLite database (`APP_DB_PATH`). The Immich database is only read.

### Staying in sync with Immich

Immich keeps changing faces after the scan (nightly facial recognition, manual edits, naming a group).
Before listing, the tool compares open suggestions with the live database – at most once a minute and
right after group actions (*Refresh list* forces it): faces that now belong to a named person or were
deleted are dropped, faces that moved to another unnamed group are re-attached there. Faces of photos
moved to the trash or the locked folder are hidden and come back if the photo is restored.
A group whose only visible face is the one under review counts as a loose face (e.g. the one-face group that
*Undo* creates for a loose face, see below).

The scan runs in the background, in batches of 50 faces, and can be paused (container restart) and
resumed; progress is stored per user. On spinning disks, put `APP_DB_PATH` on an SSD if possible –
the local SQLite driver is synchronous, so slow commits block the whole app.

### Distance

The distance is the cosine distance between face embeddings (0 = identical). Lower is more similar.
What counts as "close" depends on the recognition model and on the library; the 0.65 storage limit
is generous on purpose. Suggestions are always shown sorted by distance so you can decide where to
stop trusting them.

### Birth date filter

If a named person has a birth date, single-face mode can hide photos taken before it, or show only
those. Photos dated in 1970 or on January 1st are treated as placeholder dates and are never hidden.

## Using it

### Groups mode (start here)

One tile per unnamed group whose majority of suggestions points to the selected person, largest
groups first. Each tile shows the group size and the suggestion breakdown
(e.g. `35 Anna · 3 Ben · 0 without suggestion`).

- **Confirm groups**: select tiles (Shift+click for a range) and confirm – every face of those groups
  is assigned to the person.
- **⤢ Group detail**: all faces of one group.
  - Decide outliers right away: runner-up button, *Assign to…*, *Stranger* (hidden in the tool),
    *No face*, and the full-photo viewer per face. *Assign whole group* skips them.
  - *Assign whole group* (`Enter`), *Assign to…* another person (`A`), *New person* = give the group a name (`N`),
    *Stranger* (`S`), *No face* for the whole group (`Del`, then confirm with `Del` in the warning dialog),
    previous/next group (`←`/`→`), close (`Esc`).
    After assigning or hiding, the next group opens automatically.
- **Assign to…** (person icon on the tile): assign a group to anyone, not only to the suggested person.
- **New person** (group): gives the group a name in Immich – it becomes a named person (for someone who is not
  in your library yet). Run *Rescan* later so its faces are used as reference for other suggestions.
- If a group was named or removed in Immich meanwhile, the detail view says so and disables group actions.
- **Stranger**: hides the group in Immich (`isHidden`) and removes its suggestions from the tool.
  Undo is offered right away and in the log.

### Single-face mode

Loose faces plus faces excluded from groups (other origins selectable). Sorted by distance.

- Select and confirm / mark as *stranger* (hidden in the tool) / *no face* in bulk, Shift+click for ranges.
- **One-click mode**: clicking a photo assigns it immediately.
- **Runner-up button** under each tile assigns to the second-best person.
- **Full-photo viewer** (⤢) with the face outlined.

### Keyboard (same keys everywhere)

| Key | Photo viewer | Group detail |
|---|---|---|
| `Enter` | assign to the suggestion | assign whole group |
| `2` | assign to the runner-up | – |
| `A` | *Assign to…* (searchable person list) | *Assign to…* |
| `S` | *Stranger* – hide the face in the tool | *Stranger* – hide the group, also in Immich |
| `N` | *New person* – create a named person for this face | *New person* – name the group |
| `Del` | twice = *No face* | opens the warning dialog, `Del` again confirms |
| `←` `→` / `Esc` | navigate / close | previous / next group, close |

### Sorting

Both modes have a *Sort* dropdown plus a direction toggle; the choice is remembered per mode in the browser.

- Single faces: **Similarity** (default), **Capture date** (undated last), **Face size** (box area – a
  practical stand-in for image quality, since Immich stores no quality score), **Gap to runner-up**
  (smallest gap first = the "is it A or B?" cases).
- Groups: **Group size** (default), **Clear majority** (share of the majority suggestion), **Closest face**.

### Undo for the last action

After every assignment (single face, one-click, runner-up, whole group) and after *Stranger*, a status
bar at the bottom of the screen offers **Undo** for exactly that action for a few seconds.

### On phones and tablets

Below 768 px the page switches to a touch layout:

- compact header (mode, person, one-click, a *Filters* panel for date and origin)
- two tiles per row; selection actions in a bar at the bottom of the screen
- **long press** selects a range (instead of Shift+click)
- swipe left/right in the photo viewer and between groups in the group detail
- *Assign whole group* / *Stranger* as large buttons at the bottom of the group detail

One-click mode is the fastest way to work on a phone: tap a photo to assign it, Undo sits at the bottom.

### Log

Every action is written to the log with time, user, face, source and target person and distance.
Assignments and hidden groups can be undone – single rows or a selection (Shift+click for ranges).

## What each action does in Immich

| Action | Immich API | Undo |
|---|---|---|
| Assign / confirm | `PUT /api/faces/{personId}` with body `{ "id": faceId }` | Moves the face back to its previous person. If it had none, or that person no longer exists (Immich removes people without faces), it is moved to a new unnamed person (`POST /api/people`), because the API cannot un-assign a face; the tool then reviews it as a loose face. A deleted named person is not recreated. |
| Assign whole group | the same call for every face of the group (except excluded/rejected ones) | per face, as above |
| Stranger | `PUT /api/people/{id}` with `{ "isHidden": true }` | `isHidden: false` |
| Name group | `PUT /api/people/{id}` with `{ "name": "…" }` | name cleared again (`""`) |
| No face (face or whole group) | `DELETE /api/faces/{id}` with `{ "force": false }` (soft delete) | **No API to restore.** Only a database snapshot brings it back. |
| New person (single face) | `POST /api/people` with `{ "name": … }`, then the assign call | face moves back; the new person stays (empty) |
| Stranger (single face) | nothing (tool-only) | suggestion reopened |

**Recommendation:** take a snapshot/backup of the Immich database before the first bulk run.

## Data stored by the tool (SQLite, `APP_DB_PATH`)

Drizzle schema in `src/db/schema/faces.schema.ts`, created by migration `0005_unnamed_faces`:

- `face_suggestions` – one row per scanned face: suggestion, runner-up, distances, bounding box,
  capture date, status (`open`, `applied`, `rejected`, `excluded`, `hidden`, `deleted`, `resolved`, `unavailable`).
- `face_review_log` – audit log of all actions.
- `face_scan_state` – scan cursor and progress per user.

Migration 0005 also copies data from the camelCase tables that early development builds created at runtime
(`face_suggestion`, `face_review_log`, `face_scan_state`), then drops them. WAL mode is enabled on first use.

## Code layout

| Path | Content |
|---|---|
| `src/pages/faces/unnamed.tsx` | page (renders `components/faces/UnnamedFaces`) |
| `src/components/faces/` | UI components |
| `src/handlers/api/faces.handler.ts` | client API calls (route constants in `src/config/routes.ts`) |
| `src/pages/api/faces/` | thin API routes |
| `src/helpers/faces/` | server logic: scan, sync, queries, actions, assign |
| `src/types/faces.d.ts` | shared types |

## API routes

All under `/api/faces/`, authenticated like the rest of Power Tools:

| Route | Method | Purpose |
|---|---|---|
| `scan` | GET / POST | progress / start or resume (`{ reset: true }` starts over) |
| `people` | GET | named people with open suggestions (faces, loose faces, groups) |
| `suggestions` | GET | faces for a person (`personId`, `dateMode`, `origin`) or all faces of a group (`clusterId`); `sort`, `dir` |
| `groups` | GET | groups whose majority suggestion is `personId`; `sort`, `dir` |
| `apply` | POST | assign faces (`faceIds`, optional `personId` override) |
| `apply-group` | POST | assign whole groups (`clusterIds`, `personId`) |
| `exclude` | POST | exclude faces from group actions (`include: true` reverts) |
| `reject` | POST | hide suggestions in the tool ("stranger" for single faces) |
| `new-person` | POST | create a named person and assign a face to it |
| `delete` | POST | soft-delete face detections in Immich |
| `hide-group` | POST | hide a group in Immich and in the tool |
| `delete-group` | POST | soft-delete all face detections of a group in Immich |
| `name-group` | POST | give a group a name in Immich |
| `persons` | GET | all named people (for *Assign to…*) |
| `log` | GET | audit log |
| `undo` | POST | undo log entries (`logId` or `logIds`) |

## Known limitations

- **Immich schema**: queries read `asset_face."personGroupId"` and the per-owner `person` table
  (Immich 3.2+). Older Immich versions are not supported. People shared with the user (`person_user`) are not used.
- **Thresholds** (0.65 storage limit, 100 ANN neighbours) were tuned on one library and one model.
- **Single user tested.** Queries are scoped to the current user's assets and people, but shared
  libraries / partner sharing were not tested.
- **Undo for loose faces** creates a new unnamed person instead of restoring "no person".
- **No face** cannot be undone from the tool.
- **The same photo can show up more than once**: every tile is a face, not a photo. If a photo has two
  faces with the same suggestion (e.g. two siblings, or the same face detected twice), it appears twice.
  There is no warning for this yet.
- New faces or new named people after the scan are only picked up by *Resume* (new faces) or
  *Rescan* (better suggestions after naming more people).
