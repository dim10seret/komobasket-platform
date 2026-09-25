import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HostedOrganizationHero, { HOSTED_ORGANIZATION_BACKGROUND } from "@/components/hosted/HostedOrganizationHero";
import HostedOrganizationHeader from "@/components/hosted/HostedOrganizationHeader";
import { hostedOrganizationPath } from "@/lib/hosted-organization-routes";
import { isReservedOrganizationSlug } from "@/lib/organization-slug";
import {
  normalizeOptionalPublicHttpUrl,
  safePublicHttpUrl,
} from "@/lib/hosted-public-url";

function source(relativePath) {
  return fs.readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");
}

describe("hosted organization public foundation", () => {
  it("uses a compact mobile menu while preserving every hosted navigation link", () => {
    const header = source("HostedOrganizationHeader.tsx");

    expect(header).toContain('"use client"');
    expect(header).toContain("const [isMenuOpen, setIsMenuOpen] = useState(false)");
    expect(header).toContain('aria-controls="hosted-mobile-navigation"');
    expect(header).toContain('id="hosted-mobile-navigation"');
    expect(header).toContain("hidden border-t border-zinc-800 bg-zinc-900 lg:block");
    expect(header).toContain("border-t border-zinc-800 bg-zinc-900 px-5 py-4 lg:hidden");
    expect(header.match(/navigation\.map/g)).toHaveLength(2);
    expect(header).toContain("onClick={() => setIsMenuOpen(false)}");
    expect(header).not.toContain("overflow-x-auto");
  });

  it("uses one centrally managed decorative background across hosted Organizations only", () => {
    const renderHero = (name) => renderToStaticMarkup(createElement(HostedOrganizationHero, { eyebrow: "Hosted Organization", title: name }));
    expect(fs.existsSync(path.resolve(import.meta.dirname, "../../..", "public", HOSTED_ORGANIZATION_BACKGROUND.slice(1)))).toBe(true);
    expect(renderHero("RunBasket")).toContain(HOSTED_ORGANIZATION_BACKGROUND);
    expect(renderHero("Another Organization")).toContain(HOSTED_ORGANIZATION_BACKGROUND);

    for (const page of [
      "../../app/(hosted)/[organizationSlug]/page.tsx",
      "../../app/(hosted)/[organizationSlug]/competitions/page.tsx",
      "../../app/(hosted)/[organizationSlug]/statistics/page.tsx",
      "../../app/(hosted)/[organizationSlug]/supporters/page.tsx",
      "../../app/(hosted)/[organizationSlug]/contact/page.tsx",
      "../../app/(hosted)/[organizationSlug]/competitions/games/[gameId]/page.tsx",
      "../../app/(hosted)/[organizationSlug]/competitions/games/[gameId]/live/page.tsx",
    ]) expect(source(page)).toContain("HostedOrganizationHero");

    for (const page of [
      "../../app/(central)/page.tsx",
      "../../app/(central)/competitions/page.tsx",
      "../../app/(central)/stats/page.tsx",
      "../../app/(central)/supporters/page.tsx",
      "../../app/(central)/contact/page.tsx",
    ]) expect(source(page)).not.toContain(HOSTED_ORGANIZATION_BACKGROUND);

    const resolver = source("../../services/hosted-public-organization.service.ts");
    const manager = source("../admin/platform/OrganizationPublicPageManagement.tsx");
    expect(resolver).not.toMatch(/background_(url|image)|backgroundUrl|backgroundImage/i);
    expect(manager).not.toMatch(/background_(url|image)|backgroundUrl|backgroundImage/i);
    expect(source("HostedOrganizationHero.tsx")).not.toContain("publicHeaderLogoUrl");
  });

  it("renders the hosted Home hero with only the Organization name aligned right", () => {
    const hostedHome = source("../../app/(hosted)/[organizationSlug]/page.tsx");
    const html = renderToStaticMarkup(createElement(HostedOrganizationHero, { title: "RunBasket", rightAligned: true }));

    expect(hostedHome).toContain("rightAligned");
    expect(hostedHome).not.toContain("Hosted Organization");
    expect(hostedHome).not.toContain("Η δημόσια αγωνιστική έδρα του Οργανισμού στο KomoBasket.");
    expect(html).toContain("RunBasket");
    expect(html).toContain("md:ml-auto");
    expect(html).toContain("md:text-right");
    expect(html).not.toContain("HOSTED ORGANIZATION");
  });

  it("builds organization-scoped public routes without exposing route groups", () => {
    const routes = {
      home: hostedOrganizationPath("runbasket", "home"),
      competitions: hostedOrganizationPath("runbasket", "competitions"),
      statistics: hostedOrganizationPath("runbasket", "statistics"),
      supporters: hostedOrganizationPath("runbasket", "supporters"),
      contact: hostedOrganizationPath("runbasket", "contact"),
    };
    expect(routes).toEqual({
      home: "/runbasket",
      competitions: "/runbasket/competitions",
      statistics: "/runbasket/statistics",
      supporters: "/runbasket/supporters",
      contact: "/runbasket/contact",
    });
    expect(JSON.stringify(routes)).not.toContain("(hosted)");
  });

  it("renders only the resolved hosted identity and scoped navigation", () => {
    const html = renderToStaticMarkup(createElement(HostedOrganizationHeader, {
      organization: {
        organizationId: "organization_runbasket",
        slug: "runbasket",
        name: "RunBasket",
        canonicalLogoUrl: "https://cdn.example.test/runbasket-canonical.png",
        publicHeaderLogoUrl: "https://cdn.example.test/runbasket-partner.png",
        publicHeaderLinkUrl: "https://runbasket.example.test/partner",
      },
    }));

    expect(html).toContain("RunBasket");
    expect(html).toContain('href="/runbasket"');
    expect(html).toContain('href="/runbasket/competitions"');
    expect(html).toContain('href="/runbasket/statistics"');
    expect(html).toContain('href="/runbasket/supporters"');
    const otherOrganizationHtml = renderToStaticMarkup(createElement(HostedOrganizationHeader, {
      organization: {
        organizationId: "organization_other",
        slug: "other-org",
        name: "Other Organization",
        canonicalLogoUrl: null,
        publicHeaderLogoUrl: null,
        publicHeaderLinkUrl: null,
      },
    }));
    expect(otherOrganizationHtml).toContain('href="/other-org/supporters"');
    expect(html).toContain('href="/runbasket/contact"');
    expect(html).toContain("runbasket-partner.png");
    expect(html).toContain("https://runbasket.example.test/partner");
    expect(html).not.toContain("organization_komobasket");
    expect(html).not.toContain("SVEKKO");
  });

  it("supports a non-clickable public header logo", () => {
    const html = renderToStaticMarkup(createElement(HostedOrganizationHeader, {
      organization: {
        organizationId: "organization_runbasket",
        slug: "runbasket",
        name: "RunBasket",
        canonicalLogoUrl: null,
        publicHeaderLogoUrl: "https://cdn.example.test/partner.png",
        publicHeaderLinkUrl: null,
      },
    }));

    expect(html).toContain("partner.png");
    expect(html).not.toContain('target="_blank"');
  });

  it.each([
    "competitions",
    "history",
    "komobasket",
    "stats",
    "statistics",
    "contact",
    "admin",
    "api",
  ])("reserves the central route slug %s", (slug) => {
    expect(isReservedOrganizationSlug(slug)).toBe(true);
  });

  it("accepts only optional HTTP(S) public header URLs", () => {
    expect(normalizeOptionalPublicHttpUrl("", "Logo")).toBeNull();
    expect(normalizeOptionalPublicHttpUrl(" https://example.test/logo.png ", "Logo")).toBe(
      "https://example.test/logo.png",
    );
    expect(normalizeOptionalPublicHttpUrl("http://example.test", "Link")).toBe(
      "http://example.test/",
    );
    expect(() => normalizeOptionalPublicHttpUrl("javascript:alert(1)", "Link")).toThrow();
    expect(() => normalizeOptionalPublicHttpUrl("data:text/plain,test", "Link")).toThrow();
    expect(() => normalizeOptionalPublicHttpUrl("not a url", "Link")).toThrow();
    expect(safePublicHttpUrl("file:///tmp/logo.png")).toBeNull();
  });

  it("keeps hosted resolution server-side, fail-closed and tenant-scoped", () => {
    const resolver = source("../../services/hosted-public-organization.service.ts");
    const page = source("../../app/(hosted)/[organizationSlug]/page.tsx");
    const footer = source("HostedSupportersFooter.tsx");

    expect(resolver).toContain('import "server-only"');
    expect(resolver).toContain("publication_status");
    expect(resolver).toContain('status !== "active"');
    expect(resolver).toContain('publication_status !== "published"');
    expect(resolver).toContain("organization_komobasket");
    expect(resolver).toContain("isReservedOrganizationSlug");
    expect(resolver).toContain("notFound()");
    expect(page).toContain("resolveHostedPublicOrganization");
    expect(page).toContain("alternates");
    expect(page).not.toContain("organization_komobasket");
    expect(footer).toContain("listSupporters(organizationId, true)");
    expect(footer).not.toContain("organization_komobasket");
  });

  it("adds only nullable hosted header fields with no backfill", () => {
    const migration = source("../../../cloudflare/migrations/0028_hosted_organization_public_header.sql");

    expect(migration).toContain("ADD COLUMN public_header_logo_url TEXT");
    expect(migration).toContain("ADD COLUMN public_header_link_url TEXT");
    expect(migration).not.toMatch(/NOT NULL/i);
    expect(migration).not.toMatch(/UPDATE\s+league_organizations/i);
  });

  it("exposes hosted controls only through the existing Super Admin organization path", () => {
    const manager = source("../admin/platform/PlatformOrganizationManagement.tsx");
    const route = source("../../app/api/admin/platform/[resource]/route.ts");
    const publicHeaderLogoUploadRoute = source("../../app/api/admin/organization-public-header-logo/route.ts");

    expect(manager).toContain("publicationStatus");
    expect(manager).not.toContain('name="publicHeaderLogoUrl"');
    expect(manager).toContain("/api/admin/organization-public-header-logo");
    expect(publicHeaderLogoUploadRoute).toContain("platformPublicHeaderLogo");
    expect(source("../../services/organization-public-header-logo-operation.ts")).toContain("publicHeaderLogoUrl: logoUrl");
    expect(manager).toContain('name="publicHeaderLinkUrl"');
    expect(route).toContain("requirePlatformSuperAdmin");
  });
});
