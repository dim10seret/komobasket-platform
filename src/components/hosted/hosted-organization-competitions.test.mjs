import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hostedCompetitionGamePath, hostedLiveApiPath, hostedOrganizationPath } from "@/lib/hosted-organization-routes";

const source = (relativePath) => fs.readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");
const shared = source("../competition/PublicCompetitionsView.tsx");
const service = source("../../services/public-competition.service.ts");
const finalizedService = source("../../services/public-finalized-game.service.ts");
const liveService = source("../../services/public-live-game.service.ts");
const hostedCatalogue = source("../../app/(hosted)/[organizationSlug]/competitions/page.tsx");
const hostedGame = source("../../app/(hosted)/[organizationSlug]/competitions/games/[gameId]/page.tsx");
const hostedLive = source("../../app/(hosted)/[organizationSlug]/competitions/games/[gameId]/live/page.tsx");
const hostedApi = source("../../app/api/public/v1/organizations/[organizationSlug]/games/[gameId]/live/route.ts");
const central = source("../../app/(central)/competitions/page.tsx");

describe("hosted organization competitions and games", () => {
  it("builds only slug-scoped competition, game and LIVE routes", () => {
    expect(hostedOrganizationPath("runbasket", "competitions")).toBe("/runbasket/competitions");
    expect(hostedCompetitionGamePath("runbasket", "game / 1")).toBe("/runbasket/competitions/games/game%20%2F%201");
    expect(hostedCompetitionGamePath("runbasket", "game-1", true)).toBe("/runbasket/competitions/games/game-1/live");
    expect(hostedLiveApiPath("runbasket", "game-1")).toBe("/api/public/v1/organizations/runbasket/games/game-1/live");
  });
  it("parameterizes catalogue ownership with the trusted organization", () => {
    expect(service).toContain("getPublicCompetitionContextForOrganizationWithDb");
    expect(service).toContain("getPublicCompetitionContextForOrganization(PUBLIC_KOMOBASKET_ORGANIZATION_ID, input)");
    expect(shared).toContain("getPublicCompetitionContextForOrganization(organizationId");
    expect(hostedCatalogue).toContain("resolveHostedPublicOrganization");
    expect(hostedCatalogue).toContain("organization.organizationId");
  });
  it("keeps competition, team and game injection inside scoped reads", () => {
    expect(service).toContain("c.organization_id=?");
    expect(service).toContain("home.organization_id=? AND away.organization_id=?");
    expect(service).toContain("p.organization_id=?");
    expect(service).toContain("teams.find((team) => team.id === input.teamId)");
  });
  it("keeps shared links within the injected competition base path", () => {
    expect(shared).toContain("competitionHref(basePath");
    expect(shared).toContain("gameBasePath={gameBasePath}");
    expect(shared).toContain("`${gameBasePath}/${encodeURIComponent(game.id)}/live`");
    expect(shared).not.toContain('href="/teams/');
    expect(shared).not.toContain('href="/players/');
  });
  it("validates finalized and LIVE games against the resolved organization", () => {
    expect(finalizedService).toContain("readPlatformMatchReport(normalizedGameId, organizationId)");
    expect(liveService).toContain(".bind(gameId, organizationId)");
    expect(hostedGame).toContain("readPublicFinalizedGameForOrganization(organization.organizationId, gameId)");
    expect(hostedGame).toContain("notFound()");
    expect(hostedLive).toContain("readPublicLiveGameForOrganization(organization.organizationId, gameId)");
    expect(hostedApi).toContain("organization.organizationId");
  });
  it("uses hosted polling and hosted canonical URLs", () => {
    expect(hostedLive).toContain("endpoint={hostedLiveApiPath(organization.slug, gameId)}");
    expect(hostedCatalogue).toContain("alternates");
    expect(hostedGame).toContain("hostedCompetitionGamePath");
    expect(hostedLive).toContain("hostedCompetitionGamePath(organization.slug, gameId, true)");
  });
  it("preserves the central organization and URL wrappers", () => {
    expect(central).toContain("PUBLIC_KOMOBASKET_ORGANIZATION_ID");
    expect(central).toContain('basePath="/competitions"');
    expect(finalizedService).toContain("readPublicFinalizedGameForOrganization(PUBLIC_KOMOBASKET_ORGANIZATION_ID, gameId)");
    expect(liveService).toContain("readPublicLiveGameForOrganization(PUBLIC_ORGANIZATION_ID, gameId, options)");
  });
});
