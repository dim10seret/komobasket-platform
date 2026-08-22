import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import {
  platformAuthorizationErrorResponse,
  requirePlatformSuperAdmin,
} from "@/lib/platform-authorization";
import {
  createManagedMembership,
  createManagedOrganization,
  createManagedUser,
  listManagedMemberships,
  listManagedOrganizations,
  listManagedUsers,
  platformManagementErrorResponse,
  updateManagedMembership,
  updateManagedOrganization,
  updateManagedUser,
} from "@/services/platform-management.service";

type ManagementResource = "organizations" | "users" | "memberships";

function isManagementResource(value: string): value is ManagementResource {
  return value === "organizations" || value === "users" || value === "memberships";
}

async function requestContext(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const authorization = requireAdmin(request);
  if (authorization.response) return { response: authorization.response } as const;
  const { resource } = await context.params;
  if (!isManagementResource(resource)) {
    return {
      response: Response.json({ error: "Μη υποστηριζόμενος πόρος διαχείρισης." }, { status: 404 }),
    } as const;
  }
  const user = await resolveCanonicalAppUser(authorization.identity);
  return { authorization, resource, user, response: null } as const;
}

function errorResponse(error: unknown) {
  return (
    platformAuthorizationErrorResponse(error) ??
    platformManagementErrorResponse(error) ??
    Response.json(
      { error: error instanceof Error ? error.message : "Η ενέργεια απέτυχε." },
      { status: 400 },
    )
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    const resolved = await requestContext(request, context);
    if (resolved.response) return resolved.response;
    if (resolved.resource === "organizations") {
      return Response.json({ organizations: await listManagedOrganizations(resolved.user) });
    }

    await requirePlatformSuperAdmin(resolved.user);
    if (resolved.resource === "users") {
      return Response.json({ users: await listManagedUsers() });
    }
    const url = new URL(request.url);
    return Response.json({
      memberships: await listManagedMemberships({
        organizationId: url.searchParams.get("organizationId")?.trim() || undefined,
        userId: url.searchParams.get("userId")?.trim() || undefined,
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    const resolved = await requestContext(request, context);
    if (resolved.response) return resolved.response;
    await requirePlatformSuperAdmin(resolved.user);
    const input = (await request.json()) as Record<string, unknown>;
    const actorEmail = resolved.authorization.identity.email;
    if (resolved.resource === "organizations") {
      return Response.json(
        { organization: await createManagedOrganization(input, actorEmail) },
        { status: 201 },
      );
    }
    if (resolved.resource === "users") {
      return Response.json(
        { user: await createManagedUser(input, actorEmail) },
        { status: 201 },
      );
    }
    return Response.json(
      { membership: await createManagedMembership(input, actorEmail) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    const resolved = await requestContext(request, context);
    if (resolved.response) return resolved.response;
    await requirePlatformSuperAdmin(resolved.user);
    const input = (await request.json()) as Record<string, unknown>;
    const actorEmail = resolved.authorization.identity.email;
    if (resolved.resource === "organizations") {
      return Response.json({
        organization: await updateManagedOrganization(input, actorEmail),
      });
    }
    if (resolved.resource === "users") {
      return Response.json({ user: await updateManagedUser(input, actorEmail) });
    }
    return Response.json({
      membership: await updateManagedMembership(input, actorEmail),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
