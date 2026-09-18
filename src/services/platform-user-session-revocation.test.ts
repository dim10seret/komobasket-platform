import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "platform-management.service.ts"), "utf8");

describe("Platform user mutation session revocation hooks", () => {
  it("revokes sessions in the same batch after email change or disable", () => {
    expect(source).toContain("createRevokeAllOrganizationUserSessionsStatement");
    expect(source).toContain("normalizedEmail !== current.normalized_email");
    expect(source).toContain('status === "disabled"');
    expect(source).toContain("await db.batch(statements);");
  });

  it("revokes only when no active Organization membership remains", () => {
    expect(source).toContain("createRevokeSessionsWithoutActiveMembershipsStatement");
    expect(source).toContain('current.status === "active" && status !== "active"');
  });

  it("projects safe credential status without selecting password hashes", () => {
    expect(source).toContain("credential_configured");
    expect(source).toContain("c.password_set_at");
    expect(source).not.toContain("c.password_hash");
  });
});
