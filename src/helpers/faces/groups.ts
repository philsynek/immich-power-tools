import { sql } from "drizzle-orm";

/**
 * Per unnamed group (Immich: unnamed person / cluster): the majority suggestion among its open faces.
 * Columns: cid (group id), pid (majority person), n (faces suggesting pid), tot (open faces with a suggestion), md (best distance).
 */
export const majoritySql = (ownerId: string) => sql`
  WITH g AS (
    SELECT current_person_id AS cid, suggested_person_id AS pid, count(*) AS n, min(distance) AS md
    FROM face_suggestions
    WHERE owner_id = ${ownerId} AND status = 'open' AND current_person_id IS NOT NULL AND suggested_person_id <> ''
    GROUP BY current_person_id, suggested_person_id
  ), r AS (
    SELECT cid, pid, n, md,
      row_number() OVER (PARTITION BY cid ORDER BY n DESC, md ASC) AS rk,
      sum(n) OVER (PARTITION BY cid) AS tot
    FROM g
  )
  SELECT cid, pid, n, tot, md FROM r WHERE rk = 1`;
