import { facesRoute } from "@/helpers/faces/common";
import { listFaceSuggestions } from "@/helpers/faces/queries";
import { syncSuggestions } from "@/helpers/faces/sync";
import type { IFaceDateMode, IFaceOrigin } from "@/types/faces";

/**
 * GET ?personId= (open suggestions of a person) or ?clusterId= (all faces of an unnamed group)
 *   &dateMode=all|hidePre|onlyPre &origin=all|group|loose &sort=distance|date|size|margin &dir=asc|desc &limit= &offset= &sync=1
 */
export default facesRoute(["GET"], async (req, user) => {
  await syncSuggestions(user.id, req.query.sync === "1");
  const personId = String(req.query.personId || "");
  const clusterId = String(req.query.clusterId || "");
  if (!personId && !clusterId) return { status: 400, body: { message: "personId or clusterId required" } };
  return {
    body: await listFaceSuggestions(user.id, {
      personId, clusterId,
      dateMode: String(req.query.dateMode || "all") as IFaceDateMode,
      origin: String(req.query.origin || "all") as IFaceOrigin,
      sort: String(req.query.sort || ""), dir: String(req.query.dir) === "desc" ? "desc" : "asc",
      limit: Math.min(parseInt(String(req.query.limit || "200"), 10) || 200, 1000), offset: parseInt(String(req.query.offset || "0"), 10) || 0,
    }),
  };
});
