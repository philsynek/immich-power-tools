import { facesRoute } from "@/helpers/faces/common";
import { getScanProgress, startScan } from "@/helpers/faces/scan";

/** GET – scan progress. POST { reset? } – start or resume the scan. */
export default facesRoute(["GET", "POST"], async (req, user) => {
  if (req.method === "POST") await startScan(user.id, !!req.body?.reset);
  return { body: await getScanProgress(user.id) };
});
