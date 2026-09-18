import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = await readFile(new URL("./supporters.service.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/admin/supporters/route.ts", import.meta.url), "utf8");
const upload = await readFile(new URL("../app/api/admin/supporters/logo/route.ts", import.meta.url), "utf8");
const publicSettings = await readFile(new URL("../app/api/admin/organization-public-settings/route.ts", import.meta.url), "utf8");
const headerUpload = await readFile(new URL("../app/api/admin/organization-public-header-logo/route.ts", import.meta.url), "utf8");
const headerUploadOperation = await readFile(new URL("./organization-public-header-logo-operation.ts", import.meta.url), "utf8");
const management = await readFile(new URL("./platform-management.service.ts", import.meta.url), "utf8");
const manager = await readFile(new URL("../components/admin/SupportersManager.tsx", import.meta.url), "utf8");
const organizationPublicPage = await readFile(new URL("../components/admin/platform/OrganizationPublicPageManagement.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../components/admin/AdminDashboard.tsx", import.meta.url), "utf8");
const hostedHeader = await readFile(new URL("../components/hosted/HostedOrganizationHeader.tsx", import.meta.url), "utf8");
const hostedShell = await readFile(new URL("../components/hosted/HostedOrganizationPublicShell.tsx", import.meta.url), "utf8");
const hostedFooter = await readFile(new URL("../components/hosted/HostedSupportersFooter.tsx", import.meta.url), "utf8");
const hostedPage = await readFile(new URL("../app/(hosted)/[organizationSlug]/supporters/page.tsx", import.meta.url), "utf8");

test("supporter CRUD is scoped by the authorized organization", () => {
  assert.match(route, /requireOrganizationAccess\(user, organizationId, mode\)/);
  assert.match(route, /requirePlatformSuperAdmin\(user\)/);
  assert.ok(route.indexOf("requirePlatformSuperAdmin(user)") < route.indexOf("requireOrganizationAccess(user, organizationId, mode)"));
  assert.match(service, /WHERE id=\? AND organization_id=\?/);
  assert.match(service, /DELETE FROM league_supporters WHERE id=\? AND organization_id=\?/);
  assert.match(service, /organizationId = KOMOBASKET_ORGANIZATION_ID/);
});

test("supporter and public-header uploads use organization-owned paths", () => {
  assert.match(upload, /`supporter-logos\/\$\{organizationId\}\/\$\{filename\}`/);
  assert.match(headerUpload, /requireAdmin\(request\)/);
  assert.match(headerUpload, /platformPublicHeaderLogo\(await resolveCanonicalAppUser\(authorization\.identity\)\)\(request\)/);
  assert.match(headerUploadOperation, /`organization-logos\/\$\{organizationId\}\/public-header\/\$\{filename\}`/);
  assert.match(upload, /requirePlatformSuperAdmin\(user\)/);
  assert.match(upload, /requireOrganizationAccess\(user, organizationId, "manage"\)/);
  assert.match(headerUploadOperation, /requireOrganizationAccess\(user, organizationId, "manage"\)/);
});

test("the central Super Admin manager selects and filters every organization", () => {
  assert.match(manager, /useState\(KOMOBASKET_ORGANIZATION_ID\)/);
  assert.match(manager, /fetch\("\/api\/admin\/platform\/organizations"/);
  assert.match(manager, /body\.set\("organizationId", effectiveOrganizationId\)/);
  assert.match(manager, /organizationId: effectiveOrganizationId/);
  assert.match(manager, />Οργανισμός<select/);
  assert.match(manager, /Η επιλογή εφαρμόζεται στη δημιουργία και στο φίλτρο υπαρχόντων υποστηρικτών/);
  assert.match(dashboard, /managementView === "supporters" && canManagePlatform/);
  assert.match(dashboard, /canManageSupporters && <Link href="\/admin\/platform\?management=supporters"/);
  assert.doesNotMatch(organizationPublicPage, /SupportersManager/);
});

test("hosted navigation exposes supporters while the scoped page and footer remain", () => {
  assert.match(hostedHeader, /\["supporters", "Υποστηρικτές"\]/);
  assert.match(hostedShell, /<HostedSupportersFooter organizationId=\{organization\.organizationId\}/);
  assert.match(hostedFooter, /listSupporters\(organizationId, true\)/);
  assert.match(hostedPage, /listSupporters\(organization\.organizationId, true\)/);
  assert.match(hostedPage, /Δεν υπάρχουν ακόμη ενεργοί υποστηρικτές/);
});

test("foreign managed logo keys and unsafe protocols are rejected", () => {
  assert.match(service, /Το λογότυπο υποστηρικτή δεν ανήκει στον επιλεγμένο Οργανισμό/);
  assert.match(service, /parsed\.protocol !== "http:" && parsed\.protocol !== "https:"/);
  assert.match(management, /normalizeOptionalPublicHttpUrl\([\s\S]*Public header link URL/);
});

test("slug and publication writes remain super-admin-only", () => {
  assert.match(publicSettings, /authorized\.access\.role === "super_admin"/);
  assert.match(publicSettings, /updateManagedOrganizationPublicPresentation/);
  assert.match(management, /rejectKeys\(input, \[[\s\S]*"slug"[\s\S]*"publicationStatus"/);
});
