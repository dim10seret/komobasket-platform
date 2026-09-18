import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appFile = (relativePath: string) =>
  fileURLToPath(new URL(`../../app/${relativePath}`, import.meta.url));

const centralLayout = readFileSync(appFile("(central)/layout.tsx"), "utf8");
const hostedLayout = readFileSync(appFile("(hosted)/layout.tsx"), "utf8");
const centralFooter = readFileSync(
  new URL("./SupportersFooter.tsx", import.meta.url),
  "utf8",
);

describe("central and hosted root layout boundary", () => {
  it("keeps the existing central home, supporters, metadata, and JSON-LD in the central root", () => {
    expect(existsSync(appFile("(central)/page.tsx"))).toBe(true);
    expect(centralLayout).toContain('import "../globals.css"');
    expect(centralLayout).toContain("<SupportersFooter />");
    expect(centralLayout).toContain('"@type": "SportsOrganization"');
    expect(centralLayout).toContain('"@type": "WebSite"');
    expect(centralFooter).toContain(
      'listSupporters("organization_komobasket", true)',
    );
  });

  it("provides a clean technical hosted root without central KomoBasket markup", () => {
    expect(hostedLayout).toBeTruthy();
    expect(hostedLayout).toContain('import "../globals.css"');
    expect(hostedLayout).toContain('<html lang="el">');
    expect(hostedLayout).not.toContain("SupportersFooter");
    expect(hostedLayout).not.toContain("SportsOrganization");
    expect(hostedLayout).not.toContain("WebSite");
    expect(hostedLayout).not.toContain("KomoBasket");
  });

  it("preserves representative central route source paths without exposing route groups in URLs", () => {
    const routes = [
      ["(central)/page.tsx", "/"],
      ["(central)/admin/page.tsx", "/admin"],
      ["(central)/admin/news/page.tsx", "/admin/news"],
      ["(central)/admin/platform/page.tsx", "/admin/platform"],
      ["(central)/competitions/page.tsx", "/competitions"],
      ["(central)/stats/page.tsx", "/stats"],
      ["(central)/contact/page.tsx", "/contact"],
      ["(central)/supporters/page.tsx", "/supporters"],
      ["(central)/news/page.tsx", "/news"],
      ["(central)/teams/page.tsx", "/teams"],
    ] as const;

    for (const [source, publicPath] of routes) {
      expect(existsSync(appFile(source)), publicPath).toBe(true);
      expect(publicPath).not.toMatch(/\((central|hosted)\)/);
    }

    expect(existsSync(appFile("api/contact/route.ts"))).toBe(true);
    expect(existsSync(appFile("sitemap.ts"))).toBe(true);
    expect(existsSync(appFile("icon.png"))).toBe(true);
  });
});
