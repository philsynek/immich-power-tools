import { facesRoute } from "@/helpers/faces/common";
import { newPerson } from "@/helpers/faces/actions";

/** POST { faceId, name } – creates a named person in Immich and assigns the face to it. */
export default facesRoute(["POST"], async (req, user) => {
  const faceId = String(req.body?.faceId || "");
  const name = String(req.body?.name || "").trim();
  if (!faceId || !name) return { status: 400, body: { message: "faceId and name required" } };
  return newPerson(user, faceId, name);
});
