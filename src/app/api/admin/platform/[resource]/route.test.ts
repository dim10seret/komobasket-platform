import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), resolveUser: vi.fn(), requireSuperAdmin: vi.fn(),
  authorizationError: vi.fn(), managementError: vi.fn(), organizationUserAuthError: vi.fn(),
  listOrganizations: vi.fn(), listUsers: vi.fn(), listMemberships: vi.fn(),
  createOrganization: vi.fn(), createUser: vi.fn(), createMembership: vi.fn(),
  updateOrganization: vi.fn(), updateUser: vi.fn(), updateMembership: vi.fn(),
  deleteOrganization: vi.fn(), credentialStatus: vi.fn(), setPassword: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/app-user-identity", () => ({ resolveCanonicalAppUser: mocks.resolveUser }));
vi.mock("@/lib/platform-authorization", () => ({
  requirePlatformSuperAdmin: mocks.requireSuperAdmin,
  platformAuthorizationErrorResponse: mocks.authorizationError,
}));
vi.mock("@/services/platform-management.service", () => ({
  platformManagementErrorResponse: mocks.managementError,
  listManagedOrganizations: mocks.listOrganizations,
  listManagedUsers: mocks.listUsers,
  listManagedMemberships: mocks.listMemberships,
  createManagedOrganization: mocks.createOrganization,
  createManagedUser: mocks.createUser,
  createManagedMembership: mocks.createMembership,
  updateManagedOrganization: mocks.updateOrganization,
  updateManagedUser: mocks.updateUser,
  updateManagedMembership: mocks.updateMembership,
  deleteManagedOrganization: mocks.deleteOrganization,
}));
vi.mock("@/services/organization-user-auth.service", () => ({
  getOrganizationUserCredentialStatus: mocks.credentialStatus,
  setOrganizationUserPassword: mocks.setPassword,
  organizationUserAuthErrorResponse: mocks.organizationUserAuthError,
}));

import { GET, POST } from "./route";

const context = (resource: string) => ({ params: Promise.resolve({ resource }) });

describe("Super Admin Organization-user password management route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ identity: { email: "super@example.test" } });
    mocks.resolveUser.mockResolvedValue({ userId: "super-admin", isSuperAdmin: true });
    mocks.requireSuperAdmin.mockResolvedValue(undefined);
    mocks.authorizationError.mockReturnValue(null);
    mocks.managementError.mockReturnValue(null);
    mocks.organizationUserAuthError.mockReturnValue(null);
    mocks.credentialStatus.mockResolvedValue({ userId: "user-a", credentialConfigured: false, passwordSetAt: null });
    mocks.setPassword.mockResolvedValue({ userId: "user-a", credentialVersion: 1, passwordSetAt: "2026-09-08T12:00:00.000Z" });
  });

  it("returns safe configured status without credential secrets", async () => {
    const response = await GET(new Request("https://example.test/api/admin/platform/user-credentials?userId=user-a"), context("user-credentials"));
    const responseText = await response.text();
    expect(response.status).toBe(200);
    expect(responseText).toContain('"credentialConfigured":false');
    expect(responseText).not.toMatch(/password_hash|passwordHash|salt|derived/i);
  });

  it("sets a password only after the canonical Super Admin guard", async () => {
    const response = await POST(new Request("https://example.test/api/admin/platform/user-credentials", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user-a", password: "valid password", confirmPassword: "valid password" }),
    }), context("user-credentials"));
    expect(response.status).toBe(200);
    expect(mocks.requireSuperAdmin).toHaveBeenCalledWith({ userId: "super-admin", isSuperAdmin: true });
    expect(mocks.setPassword).toHaveBeenCalledWith("user-a", "valid password");
    expect(await response.json()).toEqual({ credential: { userId: "user-a", credentialConfigured: true, passwordSetAt: "2026-09-08T12:00:00.000Z" } });
  });

  it.each(["Organization Admin", "Viewer"])("denies %s before password mutation", async () => {
    mocks.requireSuperAdmin.mockRejectedValue(new Error("forbidden"));
    mocks.authorizationError.mockReturnValue(new Response("forbidden", { status: 403 }));
    const response = await POST(new Request("https://example.test/api/admin/platform/user-credentials", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user-a", password: "valid password", confirmPassword: "valid password" }),
    }), context("user-credentials"));
    expect(response.status).toBe(403);
    expect(mocks.setPassword).not.toHaveBeenCalled();
  });

  it("rejects a password mismatch without calling the credential service", async () => {
    const response = await POST(new Request("https://example.test/api/admin/platform/user-credentials", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user-a", password: "valid password", confirmPassword: "different password" }),
    }), context("user-credentials"));
    expect(response.status).toBe(400);
    expect(mocks.setPassword).not.toHaveBeenCalled();
  });
});
