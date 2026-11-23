import { facesRoute, idList } from "@/helpers/faces/common";
import { applyFaces } from "@/helpers/faces/actions";

/** POST { faceIds, personId? } – assign faces to their suggested person (or to personId). */
export default facesRoute(["POST"], async (req, user) => ({
  body: await applyFaces(user, idList(req.body?.faceIds), req.body?.personId || undefined),
}));
