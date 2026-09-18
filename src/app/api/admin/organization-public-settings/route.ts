import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse, requireOrganizationAccess } from "@/lib/platform-authorization";
import {
  listManagedOrganizations,
  platformManagementErrorResponse,
  updateManagedOrganization,
  updateManagedOrganizationPublicPresentation,
} from "@/services/platform-management.service";

function errorResponse(error: unknown) {
  return platformAuthorizationErrorResponse(error) ?? platformManagementErrorResponse(error)
    ?? Response.json({ error: error instanceof Error ? error.message : "Η ενέργεια απέτυχε." }, { status: 400 });
}

async function authorize(request: Request, organizationId: string, mode: "read" | "manage") {
  const admin = await requireAdmin(request);
  if (admin.response) return { response: admin.response } as const;
  const user = await resolveCanonicalAppUser(admin.identity);
  const access = await requireOrganizationAccess(user, organizationId, mode);
  return { admin, user, access, response: null } as const;
}

export async function GET(request: Request) {
  try {
    const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim() ?? "";
    if (!organizationId) return Response.json({ error: "Λείπει organizationId." }, { status: 400 });
    const authorized = await authorize(request, organizationId, "read");
    if (authorized.response) return authorized.response;
    const organization = (await listManagedOrganizations(authorized.user)).find((candidate) => candidate.id === organizationId);
    if (!organization) return Response.json({ error: "Ο Οργανισμός δεν είναι διαθέσιμος." }, { status: 404 });
    return Response.json({ organization, role: authorized.access.role });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = await request.json() as Record<string, unknown>;
    const organizationId = String(input.organizationId ?? "").trim();
    if (!organizationId) return Response.json({ error: "Λείπει organizationId." }, { status: 400 });
    const authorized = await authorize(request, organizationId, "manage");
    if (authorized.response) return authorized.response;
    const actorEmail = authorized.admin.identity.email;
    const organization = authorized.access.role === "super_admin"
      ? await updateManagedOrganization({
          organizationId,
          slug: input.slug,
          publicationStatus: input.publicationStatus,
          publicHeaderLogoUrl: input.publicHeaderLogoUrl,
          publicHeaderLinkUrl: input.publicHeaderLinkUrl,
        }, actorEmail)
      : await updateManagedOrganizationPublicPresentation(organizationId, input, actorEmail);
    return Response.json({ organization });
  } catch (error) {
    return errorResponse(error);
  }
}
