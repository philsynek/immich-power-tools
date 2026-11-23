import { facesRoute } from "@/helpers/faces/common";
import { undoActions } from "@/helpers/faces/actions";

/** POST { logIds } (or { logId }) – reverts assignments, strangers, hidden and named groups. */
export default facesRoute(["POST"], async (req, user) => {
  const raw = Array.isArray(req.body?.logIds) ? req.body.logIds : [req.body?.logId];
  const ids: number[] = raw.map(Number).filter(Boolean).slice(0, 500);
  return { body: await undoActions(user, ids) };
});
