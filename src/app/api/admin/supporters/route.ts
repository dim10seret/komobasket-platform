import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse, requireOrganizationAccess, requirePlatformSuperAdmin } from "@/lib/platform-authorization";
import { createSupporter, deleteSupporter, KOMOBASKET_ORGANIZATION_ID, listSupporters, updateSupporter } from "@/services/supporters.service";

async function authorize(request: Request, organizationId: string, mode: "read" | "manage") {
  const admin = await requireAdmin(request);
  if (admin.response) return { response: admin.response };
  const user = await resolveCanonicalAppUser(admin.identity);
  await requirePlatformSuperAdmin(user);
  await requireOrganizationAccess(user, organizationId, mode);
  return { response: null };
}

function organizationIdFromUrl(request: Request) {
  return new URL(request.url).searchParams.get("organizationId")?.trim() || KOMOBASKET_ORGANIZATION_ID;
}

function organizationIdFromInput(input: Record<string, unknown>) {
  return String(input.organizationId ?? "").trim() || KOMOBASKET_ORGANIZATION_ID;
}

function errorResponse(error: unknown) {
  return platformAuthorizationErrorResponse(error)
    ?? Response.json({ error: error instanceof Error ? error.message : "Η ενέργεια απέτυχε." }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const organizationId = organizationIdFromUrl(request);
    const authorization = await authorize(request, organizationId, "read");
    if (authorization.response) return authorization.response;
    return Response.json({ supporters: await listSupporters(organizationId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as Record<string, unknown>;
    const organizationId = organizationIdFromInput(input);
    const authorization = await authorize(request, organizationId, "manage");
    if (authorization.response) return authorization.response;
    return Response.json({ supporter: await createSupporter(input, organizationId) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = await request.json() as Record<string, unknown>;
    const organizationId = organizationIdFromInput(input);
    const authorization = await authorize(request, organizationId, "manage");
    if (authorization.response) return authorization.response;
    const id = String(input.id ?? "").trim();
    if (!id) return Response.json({ error: "Λείπει supporter id." }, { status: 400 });
    return Response.json({ supporter: await updateSupporter(id, input, organizationId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const input = await request.json() as Record<string, unknown>;
    const organizationId = organizationIdFromInput(input);
    const authorization = await authorize(request, organizationId, "manage");
    if (authorization.response) return authorization.response;
    const id = String(input.id ?? "").trim();
    if (!id) return Response.json({ error: "Λείπει supporter id." }, { status: 400 });
    await deleteSupporter(id, organizationId);
    return Response.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
