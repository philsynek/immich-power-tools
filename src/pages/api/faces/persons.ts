import { facesRoute } from "@/helpers/faces/common";
import { listNamedPeople } from "@/helpers/faces/queries";

/** GET – all named people of the current user (for the "Assign to…" picker). */
export default facesRoute(["GET"], async (_req, user) => ({ body: await listNamedPeople(user.id) }));
