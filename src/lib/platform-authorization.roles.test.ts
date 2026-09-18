import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateOrganizationPermission } from "@/lib/platform-authorization";

const activeUser = { id: "user-1", status: "active" as const, is_super_admin: 0 };
const organization = { id: "org-1", slug: "org-1", name: "Organization", status: "active" as const };

describe("canonical Platform role decisions", () => {
  it("allows Super Admin read and manage access", () => {
    const user = { ...activeUser, is_super_admin: 1 };
    expect(evaluateOrganizationPermission({ user, organization, membership: null, mode: "read" })).toEqual({ allowed: true, role: "super_admin" });
    expect(evaluateOrganizationPermission({ user, organization, membership: null, mode: "manage" })).toEqual({ allowed: true, role: "super_admin" });
  });

  it("allows an Organization Admin to read and manage its Organization", () => {
    const membership = { role: "admin" as const, status: "active" as const };
    expect(evaluateOrganizationPermission({ user: activeUser, organization, membership, mode: "read" })).toEqual({ allowed: true, role: "admin" });
    expect(evaluateOrganizationPermission({ user: activeUser, organization, membership, mode: "manage" })).toEqual({ allowed: true, role: "admin" });
  });

  it("allows Viewer reads but denies Viewer writes", () => {
    const membership = { role: "viewer" as const, status: "active" as const };
    expect(evaluateOrganizationPermission({ user: activeUser, organization, membership, mode: "read" })).toEqual({ allowed: true, role: "viewer" });
    expect(evaluateOrganizationPermission({ user: activeUser, organization, membership, mode: "manage" })).toEqual({ allowed: false, reason: "insufficient_permission" });
  });

  it("denies foreign Organizations, unknown users, and disabled users", () => {
    expect(evaluateOrganizationPermission({ user: activeUser, organization, membership: null, mode: "read" })).toEqual({ allowed: false, reason: "inaccessible_organization" });
    expect(evaluateOrganizationPermission({ user: null, organization, membership: null, mode: "read" })).toEqual({ allowed: false, reason: "unauthenticated" });
    expect(evaluateOrganizationPermission({ user: { ...activeUser, status: "disabled" }, organization, membership: null, mode: "read" })).toEqual({ allowed: false, reason: "inactive_user" });
  });
});
