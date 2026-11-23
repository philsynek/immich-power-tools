import { facesRoute, idList } from "@/helpers/faces/common";
import { rejectFaces } from "@/helpers/faces/actions";

/** POST { faceIds } – "Stranger" for single faces (tool-only). */
export default facesRoute(["POST"], async (req, user) => ({ body: await rejectFaces(user, idList(req.body?.faceIds)) }));
