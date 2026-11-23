import { facesRoute } from "@/helpers/faces/common";
import { nameGroup } from "@/helpers/faces/actions";

/** POST { clusterId, name } – names an unnamed group in Immich. */
export default facesRoute(["POST"], async (req, user) => {
  const clusterId = String(req.body?.clusterId || "");
  const name = String(req.body?.name || "").trim();
  if (!clusterId || !name) return { status: 400, body: { message: "clusterId and name required" } };
  return nameGroup(user, clusterId, name);
});
