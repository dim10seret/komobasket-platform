import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
// Use the same installed Vitest package as the repository's site-test command.
import { describe, expect, it } from "../../../komocontrol/node_modules/vitest/dist/index.js";
import HostedOrganizationHero, { HOSTED_ORGANIZATION_BACKGROUND } from "./HostedOrganizationHero";
import OrganizationSiteCoverControl from "../admin/platform/OrganizationSiteCoverControl";

const cover = "/api/organization/logos/organization-logos/org-a/site-cover/12345678-1234-1234-1234-123456789012.png";

describe("hosted Site cover presentation", () => {
  it.each([false, true])("keeps default geometry, overlay and crop for compact=%s", (compact: boolean) => {
    const original = renderToStaticMarkup(<HostedOrganizationHero title="Organization" compact={compact} rightAligned />);
    const absent = renderToStaticMarkup(<HostedOrganizationHero title="Organization" compact={compact} rightAligned siteCoverUrl={null} />);
    const custom = renderToStaticMarkup(<HostedOrganizationHero title="Organization" compact={compact} rightAligned siteCoverUrl={cover} />);
    expect(absent).toBe(original);
    expect(custom.replace(cover, HOSTED_ORGANIZATION_BACKGROUND)).toBe(original);
    expect(original).toContain("background-position:center;background-repeat:no-repeat;background-size:cover");
  });
  it.each(["page.tsx", "competitions/page.tsx", "competitions/games/[gameId]/page.tsx", "competitions/games/[gameId]/live/page.tsx", "contact/page.tsx", "statistics/page.tsx", "supporters/page.tsx"])("passes the resolved organization cover to the shared hero on %s", (page: string) => {
    const source = readFileSync(new URL("../../app/(hosted)/[organizationSlug]/" + page, import.meta.url), "utf8");
    expect(source).toMatch(/<HostedOrganizationHero\s+siteCoverUrl=\{organization\.siteCoverUrl\}/);
    expect(source).not.toContain(HOSTED_ORGANIZATION_BACKGROUND);
  });
  it("shows default guidance and no remove action without an override", () => {
    const html = renderToStaticMarkup(<OrganizationSiteCoverControl organizationId="org-a" siteCoverUrl={null} onChange={() => {}} />);
    expect(html).toContain("Χρησιμοποιείται η προεπιλεγμένη εικόνα");
    expect(html).toContain("Προαιρετικό. Αν δεν οριστεί εικόνα, θα χρησιμοποιηθεί η προεπιλεγμένη εικόνα εξωφύλλου.");
    expect(html).not.toContain("Αφαίρεση Site cover");
  });
  it("shows preview and an explicit non-submit remove button for a custom cover", () => {
    const html = renderToStaticMarkup(<OrganizationSiteCoverControl organizationId="org-a" siteCoverUrl={cover} onChange={() => {}} />);
    expect(html).toContain(cover); expect(html).toContain("Προεπισκόπηση Site cover");
    expect(html).toMatch(/<button type="button"[^>]*>Αφαίρεση Site cover<\/button>/);
    expect(html).toContain('accept="image/jpeg,image/png,image/webp,image/avif"');
  });
  it("does not expose mutation controls for a Viewer", () => {
    const html = renderToStaticMarkup(<OrganizationSiteCoverControl organizationId="org-a" siteCoverUrl={cover} canManage={false} onChange={() => {}} />);
    expect(html).toContain(cover); expect(html).not.toContain('type="file"'); expect(html).not.toContain("Αφαίρεση Site cover");
  });
});
