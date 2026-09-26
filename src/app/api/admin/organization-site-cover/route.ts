import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse } from "@/lib/platform-authorization";
import { platformSiteCover } from "@/services/organization-public-header-logo-operation";

async function handle(request: Request, method: "POST" | "DELETE") {
  const authorization = await requireAdmin(request);
  if (authorization.response) return authorization.response;
  try {
    const actor = await resolveCanonicalAppUser(authorization.identity);
    return platformSiteCover(actor)[method](request);
  } catch (error) {
    return platformAuthorizationErrorResponse(error)
      ?? Response.json({ error: "Η ενημέρωση Site cover απέτυχε." }, { status: 400 });
  }
}

export const POST = (request: Request) => handle(request, "POST");
export const DELETE = (request: Request) => handle(request, "DELETE");
