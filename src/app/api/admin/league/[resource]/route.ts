import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse } from "@/lib/platform-authorization";
import { platformLeagueResources } from "@/services/platform-league-resources";
type Context = { params: Promise<{ resource: string }> };
async function handle(request: Request, context: Context, method: "POST" | "PATCH" | "DELETE") {
  const authorization = await requireAdmin(request);
  if (authorization.response) return authorization.response;
  try { return await platformLeagueResources(await resolveCanonicalAppUser(authorization.identity))[method](request, context); }
  catch (error) { return platformAuthorizationErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "Η ενέργεια απέτυχε." }, { status: 400 }); }
}
export async function POST(request: Request, context: Context) { return handle(request, context, "POST"); }
export async function PATCH(request: Request, context: Context) { return handle(request, context, "PATCH"); }
export async function DELETE(request: Request, context: Context) { return handle(request, context, "DELETE"); }


