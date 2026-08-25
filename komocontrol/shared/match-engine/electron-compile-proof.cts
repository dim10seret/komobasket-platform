export async function loadSharedMatchEngineForElectronCompileProof(): Promise<
  typeof import("./engine/match-engine.js").MatchEngine
> {
  const { MatchEngine } = await import("./engine/match-engine.js");
  return MatchEngine;
}
