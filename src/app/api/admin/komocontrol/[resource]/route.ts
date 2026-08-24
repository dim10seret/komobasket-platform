import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse, requireOrganizationAccess } from "@/lib/platform-authorization";
import { createRegistryEntry, createScorer, komoControlAdminErrorResponse, listKomoControlSettings, listRegistry, listScorers, saveKomoControlSettings, updateRegistryEntry, updateScorer } from "@/services/komocontrol-admin.service";

type Resource = "settings" | "scorers" | "referees" | "table-officials";
const isResource = (value: string): value is Resource => ["settings", "scorers", "referees", "table-officials"].includes(value);

async function context(request: Request, route: { params: Promise<{ resource: string }> }) {
  const authorization = requireAdmin(request); if (authorization.response) return { response: authorization.response } as const;
  const { resource } = await route.params; if (!isResource(resource)) return { response: Response.json({ error: "Μη υποστηριζόμενος πόρος KomoControl." }, { status: 404 }) } as const;
  const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim() || "";
  if (!organizationId) return { response: Response.json({ error: "Απαιτείται Οργανισμός." }, { status: 400 }) } as const;
  const user = await resolveCanonicalAppUser(authorization.identity); await requireOrganizationAccess(user, organizationId, "manage");
  return { response: null, resource, organizationId } as const;
}
function failure(error: unknown) { return platformAuthorizationErrorResponse(error) ?? komoControlAdminErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "Η ενέργεια απέτυχε." }, { status: 400 }); }
export async function GET(request: Request, route: { params: Promise<{ resource: string }> }) { try { const resolved=await context(request,route);if(resolved.response)return resolved.response;const url=new URL(request.url);if(resolved.resource==="settings")return Response.json(await listKomoControlSettings(resolved.organizationId,url.searchParams.get("competitionId")?.trim()||undefined));if(resolved.resource==="scorers")return Response.json({scorers:await listScorers(resolved.organizationId)});return Response.json({entries:await listRegistry(resolved.organizationId,resolved.resource)}); } catch(error){return failure(error);} }
export async function POST(request: Request, route: { params: Promise<{ resource: string }> }) { try { const resolved=await context(request,route);if(resolved.response)return resolved.response;const input=await request.json() as Record<string,unknown>;if(resolved.resource==="settings")return Response.json({settings:await saveKomoControlSettings(resolved.organizationId,input)});if(resolved.resource==="scorers")return Response.json({scorer:await createScorer(resolved.organizationId,input)},{status:201});return Response.json({entry:await createRegistryEntry(resolved.organizationId,resolved.resource,input)},{status:201}); } catch(error){return failure(error);} }
export async function PATCH(request: Request, route: { params: Promise<{ resource: string }> }) { try { const resolved=await context(request,route);if(resolved.response)return resolved.response;const input=await request.json() as Record<string,unknown>;if(resolved.resource==="scorers"){await updateScorer(resolved.organizationId,input);return Response.json({ok:true});}if(resolved.resource==="settings")return Response.json({settings:await saveKomoControlSettings(resolved.organizationId,input)});await updateRegistryEntry(resolved.organizationId,resolved.resource,input);return Response.json({ok:true}); } catch(error){return failure(error);} }
