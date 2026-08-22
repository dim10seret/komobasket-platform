import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse, requirePlatformSuperAdmin } from "@/lib/platform-authorization";
import { createSupporter, deleteSupporter, listSupporters, updateSupporter } from "@/services/supporters.service";

async function authorize(request: Request) {
  const admin = requireAdmin(request);
  if (admin.response) return { response: admin.response };
  const user = await resolveCanonicalAppUser(admin.identity);
  await requirePlatformSuperAdmin(user);
  return { response: null };
}

function errorResponse(error: unknown) {
  return platformAuthorizationErrorResponse(error)
    ?? Response.json({ error: error instanceof Error ? error.message : "Η ενέργεια απέτυχε." }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;
    return Response.json({ supporters: await listSupporters() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;
    return Response.json({ supporter: await createSupporter(await request.json() as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;
    const input = await request.json() as Record<string, unknown>;
    const id = String(input.id ?? "").trim();
    if (!id) return Response.json({ error: "Λείπει supporter id." }, { status: 400 });
    return Response.json({ supporter: await updateSupporter(id, input) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;
    const input = await request.json() as Record<string, unknown>;
    const id = String(input.id ?? "").trim();
    if (!id) return Response.json({ error: "Λείπει supporter id." }, { status: 400 });
    await deleteSupporter(id);
    return Response.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
