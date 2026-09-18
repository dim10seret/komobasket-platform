import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const newsRoutes = [
  "../app/api/admin/news/route.ts",
  "../app/api/admin/news/[id]/route.ts",
  "../app/api/admin/news/[id]/image/route.ts",
  "../app/api/admin/news/[id]/facebook/route.ts",
  "../app/api/admin/news/[id]/attachments/route.ts",
  "../app/api/admin/news/[id]/attachments/[attachmentId]/route.ts",
];

describe("admin route authorization contracts", () => {
  it("protects the complete admin page subtree at the application layer", () => {
    const source = readFileSync(
      new URL("../app/(central)/admin/layout.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("await requireAdmin(");
    expect(source).toContain("if (authorization.response) notFound()");
  });

  it("keeps every global News endpoint explicitly Super-Admin-only", () => {
    for (const route of newsRoutes) {
      const source = readFileSync(new URL(route, import.meta.url), "utf8");
      expect(source).toContain("requirePlatformSuperAdminRequest");
      expect(source).not.toMatch(/\brequireAdmin\(/);
    }
  });

  it("awaits the asynchronous verified-JWT guard in every admin route", () => {
    const guardedRoutes = [
      "../app/api/admin/team-logo-route/route.ts",
      "../app/api/admin/supporters/route.ts",
      "../app/api/admin/supporters/logo/route.ts",
      "../app/api/admin/organization-logo/route.ts",
      "../app/api/admin/platform/[resource]/route.ts",
      "../app/api/admin/organization-public-settings/route.ts",
      "../app/api/admin/organization-public-header-logo/route.ts",
      "../app/api/admin/league/route.ts",
      "../app/api/admin/league/[resource]/route.ts",
      "../app/api/admin/komocontrol/[resource]/route.ts",
      "../app/api/admin/match-reports/[gameId]/route.ts",
      "../app/api/admin/match-reports/[gameId]/statistics/route.ts",
      "../app/api/admin/match-reports/[gameId]/game-sheet/route.ts",
    ];
    for (const route of guardedRoutes) {
      const source = readFileSync(new URL(route, import.meta.url), "utf8");
      expect(source).not.toMatch(/=\s*requireAdmin\(/);
      expect(source).toMatch(/=\s*await requireAdmin\(/);
    }
  });
});
