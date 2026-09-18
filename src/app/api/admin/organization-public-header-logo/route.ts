import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse } from "@/lib/platform-authorization";
import { platformPublicHeaderLogo } from "@/services/organization-public-header-logo-operation";
export async function POST(request: Request) {
 const authorization = await requireAdmin(request);
 if (authorization.response) return authorization.response;
 try { return await platformPublicHeaderLogo(await resolveCanonicalAppUser(authorization.identity))(request); }
 catch (error) { return platformAuthorizationErrorResponse(error) ?? Response.json({error: error instanceof Error ? error.message : "Το upload απέτυχε."}, {status:500}); }
}
