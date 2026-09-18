import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "TeamsSection.tsx"), "utf8");

describe("Platform team-logo presentation", () => {
  test("uses the canonical Team logo in participation rows", () => {
    expect(source).toContain("const teamById = new Map(data.teams.map((team) => [String(team.id), team]));");
    expect(source).toContain('const canonicalTeam = teamById.get(String(participation.team_id ?? ""));');
    expect(source).toContain('const canonicalTeamLogoUrl = String(canonicalTeam?.logo_url ?? "").trim();');
    expect(source).toContain('{canonicalTeamLogoUrl ? <img src={canonicalTeamLogoUrl} alt="" className="h-8 w-8 shrink-0 rounded-md object-contain" /> : null}');
  });

  test("preserves add-team selector logos and the existing participation edit flow", () => {
    expect(source).toContain('{teamLogoUrl ? <img src={teamLogoUrl} alt="" className="h-7 w-7 shrink-0 rounded-md object-contain" /> : null}');
    expect(source).toContain('defaultValue={canonicalTeamLogoUrl}');
    expect(source).toContain("uploadParticipationLogoFile(file, String(participation.team_id ?? \"\"))");
  });
});
