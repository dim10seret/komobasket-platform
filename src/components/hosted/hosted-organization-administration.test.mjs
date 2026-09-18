import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const supportersPage = await readFile(new URL("../../app/(hosted)/[organizationSlug]/supporters/page.tsx", import.meta.url), "utf8");
const contactPage = await readFile(new URL("../../app/(hosted)/[organizationSlug]/contact/page.tsx", import.meta.url), "utf8");
const contactContent = await readFile(new URL("../contact/ContactContent.tsx", import.meta.url), "utf8");
const centralContact = await readFile(new URL("../../app/(central)/contact/page.tsx", import.meta.url), "utf8");
const centralSupporters = await readFile(new URL("../../app/(central)/supporters/page.tsx", import.meta.url), "utf8");
const header = await readFile(new URL("./HostedOrganizationHeader.tsx", import.meta.url), "utf8");
const manager = await readFile(new URL("../admin/platform/OrganizationPublicPageManagement.tsx", import.meta.url), "utf8");
const superAdminManager = await readFile(new URL("../admin/platform/PlatformOrganizationManagement.tsx", import.meta.url), "utf8");

test("hosted supporters resolve and read only active supporters from their organization", () => {
  assert.match(supportersPage, /resolveHostedPublicOrganization\(organizationSlug\)/);
  assert.match(supportersPage, /listSupporters\(organization\.organizationId, true\)/);
  assert.doesNotMatch(supportersPage, /organization_komobasket/);
  assert.match(centralSupporters, /listSupporters\("organization_komobasket", true\)/);
});

test("hosted contact reuses the central form and central endpoint", () => {
  assert.match(contactPage, /<ContactContent hostedOrganizationName=\{organization\.name\} hero=/);
  assert.match(centralContact, /<Header \/><ContactContent \/>/);
  assert.match(contactContent, /fetch\("\/api\/contact"/);
  assert.match(contactContent, /Επικοινωνία με το KomoBasket Platform/);
  assert.match(contactContent, /κεντρική ομάδα του KomoBasket Platform/);
  assert.match(contactContent, /όχι απευθείας στον οργανισμό \$\{hostedOrganizationName\}/);
  assert.doesNotMatch(centralContact, /hostedOrganizationName/);
  assert.doesNotMatch(contactPage, /RunBasket/);
  assert.match(contactContent, /fetch\("\/api\/contact", \{/);
});

test("hosted navigation has real organization-scoped destinations", () => {
  for (const route of ["home", "competitions", "statistics", "supporters", "contact"]) {
    assert.match(header, new RegExp(`\\["${route}",`));
  }
  assert.match(header, /hostedOrganizationPath\(organization\.slug, route\)/);
});

test("public administration renders role-specific controls", () => {
  assert.match(manager, /const canManage = role !== "viewer"/);
  assert.match(manager, /const canPublish = role === "super_admin"/);
  assert.match(manager, /readOnly=\{!canManage\}/);
  assert.match(manager, /Canonical Organization logo/);
  assert.doesNotMatch(manager, /SupportersManager/);
});

test("public header branding uses upload instead of a manual image URL", () => {
  assert.doesNotMatch(manager, /name="publicHeaderLogoUrl"/);
  assert.doesNotMatch(superAdminManager, /name="publicHeaderLogoUrl"/);
  assert.match(manager, /\/api\/admin\/organization-public-header-logo/);
  assert.match(superAdminManager, /\/api\/admin\/organization-public-header-logo/);
  assert.match(manager, /Σύνδεσμος λογοτύπου \(προαιρετικό\)/);
  assert.match(superAdminManager, /Σύνδεσμος λογοτύπου \(προαιρετικό\)/);
  assert.match(manager, /public_header_logo_url/);
  assert.match(superAdminManager, /public_header_logo_url/);
});
