import { facesRoute } from "@/helpers/faces/common";
import { listFacePeople } from "@/helpers/faces/queries";
import { syncSuggestions } from "@/helpers/faces/sync";

/** GET ?sync=1 – named people with open suggestions. */
export default facesRoute(["GET"], async (req, user) => {
  await syncSuggestions(user.id, req.query.sync === "1");
  return { body: await listFacePeople(user.id) };
});
