import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/public-mobile-catalogue.service", () => ({
  listMobileSeasons: vi.fn(),
  listMobileOrganizations: vi.fn(),
  listMobileCompetitions: vi.fn(),
}));

import { GET as getSeasons } from "./seasons/route";
import { GET as getOrganizations } from "./organizations/route";
import { GET as getCompetitions } from "./competitions/route";
import {
  listMobileSeasons,
  listMobileOrganizations,
  listMobileCompetitions,
} from "@/services/public-mobile-catalogue.service";

const request = (path: string) => new Request(`https://example.test${path}`);

describe("Phase A1 public catalogue route contract", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns seasons in the data envelope with a public cache header", async () => {
    vi.mocked(listMobileSeasons).mockResolvedValue([
      { id: "season-example", name: "2026-27", slug: "2026-27", startDate: "2026-09-01", endDate: null },
    ]);
    const response = await getSeasons();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600");
    expect(await response.json()).toEqual({ data: [
      { id: "season-example", name: "2026-27", slug: "2026-27", startDate: "2026-09-01", endDate: null },
    ] });
  });

  it("validates seasonId and uses the same safe error for unknown and non-public seasons", async () => {
    for (const path of [
      "/api/public/v1/organizations",
      "/api/public/v1/organizations?seasonId=",
      "/api/public/v1/organizations?seasonId=a&seasonId=b",
    ]) {
      const response = await getOrganizations(request(path));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: {
        code: "INVALID_SEASON_ID", message: "A valid seasonId is required.",
      } });
    }
    expect(listMobileOrganizations).not.toHaveBeenCalled();

    vi.mocked(listMobileOrganizations).mockResolvedValue(null);
    const response = await getOrganizations(request("/api/public/v1/organizations?seasonId=hidden"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: {
      code: "SEASON_NOT_FOUND", message: "Season not found.",
    } });
  });

  it("returns organizations with the public projection and cache policy", async () => {
    vi.mocked(listMobileOrganizations).mockResolvedValue([
      { id: "org-example", slug: "example", name: "Example", logoUrl: null },
    ]);
    const response = await getOrganizations(request("/api/public/v1/organizations?seasonId=season-example"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=1800");
    expect(await response.json()).toEqual({ data: [
      { id: "org-example", slug: "example", name: "Example", logoUrl: null },
    ] });
    expect(listMobileOrganizations).toHaveBeenCalledWith("season-example");
  });

  it("validates both competition filters and hides mismatched or private selections", async () => {
    let response = await getCompetitions(request("/api/public/v1/competitions?organizationId=org-example"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: {
      code: "INVALID_SEASON_ID", message: "A valid seasonId is required.",
    } });
    response = await getCompetitions(request("/api/public/v1/competitions?seasonId=season-example"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: {
      code: "INVALID_ORGANIZATION_ID", message: "A valid organizationId is required.",
    } });
    expect(listMobileCompetitions).not.toHaveBeenCalled();

    vi.mocked(listMobileCompetitions).mockResolvedValue(null);
    response = await getCompetitions(request("/api/public/v1/competitions?seasonId=season-example&organizationId=wrong"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: {
      code: "CATALOGUE_NOT_FOUND", message: "Catalogue selection not found.",
    } });
  });

  it("returns competition DTOs and masks backend failures", async () => {
    vi.mocked(listMobileCompetitions).mockResolvedValue([
      { id: "competition-example", organizationId: "org-example", seasonId: "season-example",
        slug: "league", name: "Example League", type: "league", logoUrl: null },
    ]);
    let response = await getCompetitions(request("/api/public/v1/competitions?seasonId=season-example&organizationId=org-example"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=120, s-maxage=600");
    expect(await response.json()).toEqual({ data: [
      { id: "competition-example", organizationId: "org-example", seasonId: "season-example",
        slug: "league", name: "Example League", type: "league", logoUrl: null },
    ] });

    vi.mocked(listMobileCompetitions).mockRejectedValue(new Error("private SQL details"));
    response = await getCompetitions(request("/api/public/v1/competitions?seasonId=season-example&organizationId=org-example"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: {
      code: "CATALOGUE_UNAVAILABLE", message: "Public catalogue is temporarily unavailable.",
    } });
  });
});
