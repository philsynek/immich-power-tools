import { facesRoute, idList } from "@/helpers/faces/common";
import { applyGroups } from "@/helpers/faces/actions";

/** POST { clusterIds, personId } – assign every face of the given unnamed groups to personId. */
export default facesRoute(["POST"], async (req, user) => {
  const clusterIds = req.body?.clusterId ? [String(req.body.clusterId)] : idList(req.body?.clusterIds, 200);
  const personId = String(req.body?.personId || "");
  if (!clusterIds.length || !personId) return { status: 400, body: { message: "clusterIds and personId required" } };
  return { body: await applyGroups(user, clusterIds, personId) };
});
