export type PublishedGamePackageDownloadRow = {
  id: string;
  game_id: string;
  organization_id: string;
  package_version: number;
  status: string;
  snapshot_json: string;
  snapshot_hash: string;
  published_at: string;
};

export type KomoControlGamePackageEnvelope = {
  packageId: string;
  gameId: string;
  packageVersion: number;
  packageSchemaVersion: 1;
  publishedAt: string;
  payloadJson: string;
  payloadHash: string;
};

export class GamePackageUnavailableError extends Error {
  readonly status = 404;
  readonly code = "PACKAGE_UNAVAILABLE";
  constructor() { super("Published GamePackage is unavailable."); this.name = "GamePackageUnavailableError"; }
}

export function projectCurrentPublishedGamePackage(
  row: PublishedGamePackageDownloadRow | null,
  organizationId: string,
  requestedGameId: string,
): KomoControlGamePackageEnvelope {
  if (!row || row.status !== "published" || row.organization_id !== organizationId || row.game_id !== requestedGameId) {
    throw new GamePackageUnavailableError();
  }
  if (!row.id.trim() || !Number.isInteger(row.package_version) || row.package_version < 1 || !row.published_at.trim()) {
    throw new Error("Invalid canonical GamePackage row.");
  }
  if (!row.snapshot_json.trim() || !/^[0-9a-f]{64}$/.test(row.snapshot_hash)) {
    throw new Error("Invalid canonical GamePackage payload metadata.");
  }
  return {
    packageId: row.id,
    gameId: row.game_id,
    packageVersion: row.package_version,
    packageSchemaVersion: 1,
    publishedAt: row.published_at,
    payloadJson: row.snapshot_json,
    payloadHash: row.snapshot_hash,
  };
}
