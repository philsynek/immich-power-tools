import { facesRoute, idList } from "@/helpers/faces/common";
import { excludeFaces } from "@/helpers/faces/actions";

/** POST { faceIds, include? } – exclude faces from group actions, or take them back (tool-only). */
export default facesRoute(["POST"], async (req, user) => ({
  body: await excludeFaces(user, idList(req.body?.faceIds), !!req.body?.include),
}));
