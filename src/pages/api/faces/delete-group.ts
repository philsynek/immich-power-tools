import { facesRoute } from "@/helpers/faces/common";
import { deleteGroup } from "@/helpers/faces/actions";

/** POST { clusterId } – "No face" for a whole unnamed group. Cannot be undone. */
export default facesRoute(["POST"], async (req, user) => {
  const clusterId = String(req.body?.clusterId || "");
  if (!clusterId) return { status: 400, body: { message: "clusterId required" } };
  return { body: await deleteGroup(user, clusterId) };
});
