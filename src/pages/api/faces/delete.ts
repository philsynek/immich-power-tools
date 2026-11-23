import { facesRoute, idList } from "@/helpers/faces/common";
import { deleteFaces } from "@/helpers/faces/actions";

/** POST { faceIds } – "No face": soft-deletes the face detections in Immich. Cannot be undone. */
export default facesRoute(["POST"], async (req, user) => ({ body: await deleteFaces(user, idList(req.body?.faceIds)) }));
