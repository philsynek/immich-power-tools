import { facesRoute } from "@/helpers/faces/common";
import { hideGroup } from "@/helpers/faces/actions";

/** POST { clusterId } – "Stranger" for an unnamed group (hidden in Immich). */
export default facesRoute(["POST"], async (req, user) => {
  const clusterId = String(req.body?.clusterId || "");
  if (!clusterId) return { status: 400, body: { message: "clusterId required" } };
  return hideGroup(user, clusterId);
});
