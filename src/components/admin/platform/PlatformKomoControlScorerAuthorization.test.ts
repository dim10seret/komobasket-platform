import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visibleKomoControlTabs } from "./PlatformKomoControlManagement";

const route = readFileSync(new URL("../../../app/api/admin/komocontrol/[resource]/route.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../AdminDashboard.tsx", import.meta.url), "utf8");
const component = readFileSync(new URL("./PlatformKomoControlManagement.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../../services/komocontrol-admin.service.ts", import.meta.url), "utf8");
const scorerAuth = readFileSync(new URL("../../../services/komocontrol-scorer-auth.service.ts", import.meta.url), "utf8");

describe("Platform Super Admin-only scorer management", () => {
  it("shows Scorers only to Platform Super Admins", () => {
    expect(visibleKomoControlTabs(true).map(([id]) => id)).toContain("scorers");
    expect(visibleKomoControlTabs(false).map(([id]) => id)).not.toContain("scorers");
    expect(dashboard).toContain("isSuperAdmin={canManagePlatform}");
  });

  it("does not fetch or render scorer management for Organization Admins and viewers", () => {
    expect(component).toContain('const scorerRequest = isSuperAdmin ? payload(await fetch(endpoint("scorers")');
    expect(component).toContain('isSuperAdmin && tab === "scorers"');
  });

  it("requires Platform Super Admin authorization for every scorer GET, POST, and PATCH", () => {
    expect(route).toContain('if (resource === "scorers") await requirePlatformSuperAdmin(user)');
    expect(route).toContain('await requireOrganizationAccess(user, organizationId, "manage")');
    expect(route).toContain('resolved.resource==="scorers"');
  });

  it("keeps create and direct-ID updates scoped to the selected Organization", () => {
    expect(service).toContain("INSERT INTO league_komocontrol_scorers (id, organization_id");
    expect(service).toContain("bind(scorerId, organizationId, username, normalized, passwordHash");
    expect(service).toContain("WHERE id=? AND organization_id=?");
    expect(service).toContain("bind(scorerId, organizationId).first()");
  });

  it("keeps passwords hashed, never returns the existing password, and invalidates old credentials on reset", () => {
    expect(service).toContain("createScorerPasswordHash(password)");
    expect(service).toContain("password_hash=?, credential_version=credential_version+1");
    expect(service).not.toContain("SELECT password_hash FROM league_komocontrol_scorers WHERE organization_id");
  });

  it("leaves existing scorer login and Organization discovery semantics unchanged", () => {
    expect(scorerAuth).toContain("findScorerByNormalizedUsername");
    expect(scorerAuth).toContain("organizationId: row.organization_id");
    expect(scorerAuth).toContain("credentialVersion: row.scorer_credential_version");
  });
});
