import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TeamsSection.tsx", import.meta.url), "utf8");

describe("TeamsSection participation logo draft", () => {
  it("uploads without persisting the master team before participation save", () => {
    const upload = source.match(/async function uploadParticipationLogoFile[\s\S]*?\n  \}/u)?.[0] ?? "";
    expect(upload).toContain('fd.append("teamId", "")');
    expect(upload).toContain("setEditParticipationLogoUrl(payload.logoUrl ?? \"\")");
    expect(upload).toContain("setEditParticipationLogoFileName(file.name)");
    expect(upload).not.toContain("updateEntity(");
  });

  it("previews and submits the pending logo from React state", () => {
    expect(source).toContain('name="logoUrl" value={editParticipationLogoUrl || canonicalTeamLogoUrl} readOnly');
    expect(source).toContain('src={editParticipationLogoUrl || canonicalTeamLogoUrl}');
    expect(source).toContain("setEditParticipationLogoUrl(nextEditingId ? canonicalTeamLogoUrl : \"\")");
    expect(source).toContain("if (file) void uploadParticipationLogoFile(file)");
  });

  it("clears the pending draft after cancel, save, or removal", () => {
    expect(source).toContain('const nextEditingId = isEditing ? null : id');
    expect(source.match(/setEditParticipationLogoUrl\(""\)/gu)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source.match(/setEditParticipationLogoFileName\(""\)/gu)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
