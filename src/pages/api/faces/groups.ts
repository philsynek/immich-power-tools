import { facesRoute } from "@/helpers/faces/common";
import { listFaceGroups } from "@/helpers/faces/queries";
import { syncSuggestions } from "@/helpers/faces/sync";

/** GET ?personId=&sort=size|share|best&dir=&limit=&offset=&sync=1 – unnamed groups whose majority is personId. */
export default facesRoute(["GET"], async (req, user) => {
  await syncSuggestions(user.id, req.query.sync === "1");
  const personId = String(req.query.personId || "");
  if (!personId) return { status: 400, body: { message: "personId required" } };
  return {
    body: await listFaceGroups(user.id, {
      personId, sort: String(req.query.sort || ""), dir: String(req.query.dir || ""),
      limit: Math.min(parseInt(String(req.query.limit || "100"), 10) || 100, 500), offset: parseInt(String(req.query.offset || "0"), 10) || 0,
    }),
  };
});
