import { facesRoute } from "@/helpers/faces/common";
import { listFaceLog } from "@/helpers/faces/queries";

/** GET ?limit= – the audit log, newest first. */
export default facesRoute(["GET"], async (req, user) => ({
  body: await listFaceLog(user.id, Math.min(parseInt(String(req.query.limit || "1000"), 10) || 1000, 5000)),
}));
