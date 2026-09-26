import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";
import type { CanonicalAppUser } from "@/lib/app-user-identity";

const fixture = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  actor: { userId: "admin-a", email: "admin@example.test", displayName: null, isSuperAdmin: false, isLocal: false },
  denied: false,
  put: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: async () => fixture.env }));
vi.mock("node:fs/promises", async (original) => ({ ...await original<typeof import("node:fs/promises")>(), mkdir: fixture.mkdir, writeFile: fixture.writeFile }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: async () => fixture.denied
  ? { response: Response.json({ error: "Unauthorized" }, { status: 401 }) }
  : { identity: { email: "admin@example.test" }, response: null } }));
vi.mock("@/lib/app-user-identity", async (original) => ({
  ...await original<typeof import("@/lib/app-user-identity")>(), resolveCanonicalAppUser: async () => fixture.actor,
}));

import { POST, DELETE } from "@/app/api/admin/organization-site-cover/route";
import { platformPublicHeaderLogo, platformSiteCover } from "./organization-public-header-logo-operation";
import { listManagedOrganizations, updateManagedOrganizationSiteCover } from "./platform-management.service";
import { readHostedPublicOrganization } from "./hosted-public-organization.service";
import { normalizeOptionalOrganizationSiteCoverUrl, safeOrganizationSiteCoverUrl } from "@/lib/hosted-public-url";

type LocalDb = { exec(sql: string): void; prepare(sql: string): { get(...values: unknown[]): unknown; all(...values: unknown[]): unknown[]; run(...values: unknown[]): { changes: number | bigint } }; close(): void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => LocalDb };
const schema = readFileSync(new URL("../../cloudflare/league-schema.sql", import.meta.url), "utf8");
const foundation = readFileSync(new URL("../../cloudflare/migrations/0001_platform_foundation.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../cloudflare/migrations/0037_organization_site_cover.sql", import.meta.url), "utf8");
const cover = "/api/organization/logos/organization-logos/org-a/site-cover/12345678-1234-1234-1234-123456789012.png";
let sqlite: LocalDb;
let db: D1DatabaseBinding;
function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...args) => statement(sql, args),
    first: async <T,>() => (sqlite.prepare(sql).get(...values) as T | undefined) ?? null,
    all: async <T,>() => ({ success: true, results: sqlite.prepare(sql).all(...values) as T[] }),
    run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  };
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.put.mockResolvedValue({}); fixture.mkdir.mockResolvedValue(undefined); fixture.writeFile.mockResolvedValue(undefined);
  fixture.denied = false;
  fixture.actor = { userId: "admin-a", email: "admin@example.test", displayName: null, isSuperAdmin: false, isLocal: false };
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  for (const ddl of foundation.matchAll(/CREATE TABLE IF NOT EXISTS [a-z_]+\s*\([\s\S]*?\);/g)) sqlite.exec(ddl[0]);
  sqlite.exec(`
    INSERT INTO league_organizations(id,slug,name,publication_status,logo_url,public_header_logo_url,public_header_link_url)
      VALUES ('org-a','cover-a','Organization A','published','/canonical.png','https://example.test/header.png','https://example.test/partner'),
             ('org-b','cover-b','Organization B','published',NULL,NULL,NULL);
    INSERT INTO league_app_users(id,email,normalized_email,is_super_admin)
      VALUES ('admin-a','admin@example.test','admin@example.test',0),('super','super@example.test','super@example.test',1);
    INSERT INTO league_organization_memberships(id,organization_id,user_id,role) VALUES ('membership-a','org-a','admin-a','admin');
  `);
  db = { prepare: statement, batch: async (items) => {
    sqlite.exec("BEGIN");
    try { const result = []; for (const item of items) result.push(await item.run()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  fixture.env = { NEWS_DB: db, NEWS_IMAGES: { put: fixture.put } };
});
afterEach(() => { vi.restoreAllMocks(); sqlite.close(); });
const current = () => sqlite.prepare("SELECT * FROM league_organizations WHERE id='org-a'").get() as Record<string, unknown>;
function upload(file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "cover.png", { type: "image/png" }), organizationId = "org-a") {
  const body = new FormData(); body.set("organizationId", organizationId); body.set("file", file);
  return new Request("https://example.test/api/admin/organization-site-cover", { method: "POST", body });
}
function removal(organizationId = "org-a") {
  return new Request("https://example.test/api/admin/organization-site-cover", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId }) });
}

describe("organization Site cover persistence and canonical upload", () => {
  it("adds only a nullable reference without changing existing rows", () => {
    const old = new DatabaseSync(":memory:");
    try {
      old.exec("CREATE TABLE league_organizations(id TEXT PRIMARY KEY, name TEXT); INSERT INTO league_organizations VALUES ('existing','Existing');");
      old.exec(migration);
      expect(old.prepare("SELECT * FROM league_organizations").all()).toEqual([{ id: "existing", name: "Existing", site_cover_url: null }]);
      expect(old.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    } finally { old.close(); }
    expect(migration).not.toMatch(/NOT NULL|UPDATE|DELETE|DROP/i);
  });
  it("uploads, replaces, reloads and removes without changing identity, logos or publication", async () => {
    const original = current();
    expect((await readHostedPublicOrganization("cover-a"))?.siteCoverUrl).toBeNull();
    const first = await POST(upload()); expect(first.status).toBe(200);
    const a = await first.json(); expect(a.siteCoverUrl).toMatch(/^\/api\/organization\/logos\/organization-logos\/org-a\/site-cover\/.+\.png$/);
    expect(a.organization.site_cover_url).toBe(a.siteCoverUrl);
    expect(current().site_cover_url).toBe(a.siteCoverUrl);
    expect((await listManagedOrganizations(fixture.actor))[0].site_cover_url).toBe(a.siteCoverUrl);
    expect((await readHostedPublicOrganization("cover-a"))?.siteCoverUrl).toBe(a.siteCoverUrl);
    expect((await readHostedPublicOrganization("cover-b"))?.siteCoverUrl).toBeNull();
    const second = await POST(upload()); expect(second.status).toBe(200);
    const b = await second.json(); expect(b.siteCoverUrl).not.toBe(a.siteCoverUrl);
    expect(current().site_cover_url).toBe(b.siteCoverUrl);
    expect((await DELETE(removal())).status).toBe(200);
    expect(current().site_cover_url).toBeNull();
    expect((await readHostedPublicOrganization("cover-a"))?.siteCoverUrl).toBeNull();
    for (const key of ["id", "slug", "name", "logo_url", "public_header_logo_url", "public_header_link_url", "publication_status"]) expect(current()[key]).toEqual(original[key]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM league_audit_log WHERE action='update_site_cover'").get()).toEqual({ n: 3 });
    expect(fixture.put).toHaveBeenCalledTimes(2);
  });
  it("uses the same pipeline for the existing header logo with no cover mutation", async () => {
    const response = await platformPublicHeaderLogo(fixture.actor)(upload());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.logoUrl).toContain("/org-a/public-header/");
    expect(current().public_header_logo_url).toBe(body.logoUrl);
    expect(current().site_cover_url).toBeNull();
  });
  it("uses the existing local-filesystem fallback without adding a storage provider", async () => {
    delete fixture.env.NEWS_IMAGES;
    const response = await POST(upload()); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.siteCoverUrl).toContain("/uploads/organization-logos/org-a/site-cover/");
    expect(fixture.mkdir).toHaveBeenCalledWith(expect.stringMatching(/public[\\/]uploads[\\/]organization-logos[\\/]org-a[\\/]site-cover$/), { recursive: true });
    expect(fixture.writeFile).toHaveBeenCalledTimes(1);
    expect(fixture.put).not.toHaveBeenCalled();
  });
  it("keeps the previous cover if uploading its replacement fails", async () => {
    await updateManagedOrganizationSiteCover("org-a", cover, "admin@example.test");
    fixture.put.mockRejectedValueOnce(new Error("Disposable storage failure"));
    expect((await POST(upload())).status).toBe(400);
    expect(current().site_cover_url).toBe(cover);
  });
  it("keeps the previous cover when persistence fails after upload", async () => {
    await updateManagedOrganizationSiteCover("org-a", cover, "admin@example.test");
    vi.spyOn(db, "batch").mockRejectedValueOnce(new Error("Disposable database failure"));
    expect((await POST(upload())).status).toBe(400);
    expect(current().site_cover_url).toBe(cover);
  });
  it.each([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/avif", "avif"]])("reuses the allowed %s type", async (type, extension) => {
    const response = await POST(upload(new File(["image fixture"], "ignored-name.txt", { type })));
    expect(response.status).toBe(200); expect((await response.json()).siteCoverUrl).toMatch(new RegExp("\\." + extension + "$"));
  });
  it.each([
    new File(["bad"], "bad.svg", { type: "image/svg+xml" }),
    new File(["bad"], "bad.txt", { type: "text/plain" }),
    new File([], "empty.png", { type: "image/png" }),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
  ])("rejects invalid upload $name without changing the cover", async (file) => {
    await updateManagedOrganizationSiteCover("org-a", cover, "admin@example.test");
    expect((await POST(upload(file))).status).toBe(400);
    expect(fixture.put).not.toHaveBeenCalled(); expect(current().site_cover_url).toBe(cover);
  });
});

describe("Site cover organization authorization", () => {
  it("denies unauthenticated upload and removal at the Admin API", async () => {
    fixture.denied = true;
    expect((await POST(upload())).status).toBe(401); expect((await DELETE(removal())).status).toBe(401);
    expect(fixture.put).not.toHaveBeenCalled();
  });
  it("denies Viewer mutations using canonical membership checks", async () => {
    sqlite.exec("UPDATE league_organization_memberships SET role='viewer'");
    expect((await POST(upload())).status).toBe(403); expect((await DELETE(removal())).status).toBe(403);
    expect(fixture.put).not.toHaveBeenCalled(); expect(current().site_cover_url).toBeNull();
  });
  it("rejects a foreign organization on upload and removal", async () => {
    expect((await POST(upload(undefined, "org-b"))).status).toBe(403);
    expect((await DELETE(removal("org-b"))).status).toBe(403);
    expect(fixture.put).not.toHaveBeenCalled();
  });
  it("does not allow a second membership to bypass the selected organization scope", async () => {
    sqlite.exec("INSERT INTO league_organization_memberships(id,organization_id,user_id,role) VALUES ('b','org-b','admin-a','admin')");
    const scoped = platformSiteCover(fixture.actor, "org-a");
    expect((await scoped.POST(upload(undefined, "org-b"))).status).toBe(403);
    expect((await scoped.DELETE(removal("org-b"))).status).toBe(403);
  });
  it("allows canonical Super Admin management", async () => {
    const actor: CanonicalAppUser = { ...fixture.actor, userId: "super", isSuperAdmin: true };
    expect((await platformSiteCover(actor).POST(upload(undefined, "org-b"))).status).toBe(200);
  });
  it.each(["https://external.test/image.png", "javascript:alert(1)", "/images/default.png", cover.replace("org-a", "org-b"), cover.replace("site-cover", "public-header"), cover + "?x=1", cover.replace("12345678-1234-1234-1234-123456789012.png", "../other.png")])("rejects unowned or unsupported reference %s", async (value) => {
    expect(() => normalizeOptionalOrganizationSiteCoverUrl(value, "org-a")).toThrow();
    expect(safeOrganizationSiteCoverUrl(value, "org-a")).toBeNull();
    await expect(updateManagedOrganizationSiteCover("org-a", value, "admin@example.test")).rejects.toThrow();
    expect(current().site_cover_url).toBeNull();
  });
});
