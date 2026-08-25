CREATE TABLE local_game_packages (
    package_id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL CHECK (length(trim(game_id)) > 0),
    package_version INTEGER NOT NULL CHECK (package_version > 0),
    package_schema_version INTEGER NOT NULL CHECK (package_schema_version = 1),
    payload_json TEXT NOT NULL CHECK (length(trim(payload_json)) > 0),
    payload_hash TEXT NOT NULL CHECK (
        length(payload_hash) = 64
        AND payload_hash NOT GLOB '*[^0-9a-f]*'
    ),
    published_at_utc TEXT,
    downloaded_at_utc TEXT NOT NULL CHECK (length(downloaded_at_utc) >= 20),
    is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
    UNIQUE (game_id, package_version)
) STRICT;

CREATE UNIQUE INDEX idx_local_game_packages_one_current_per_game
    ON local_game_packages(game_id)
    WHERE is_current = 1;

CREATE TRIGGER trg_local_game_packages_immutable
BEFORE UPDATE OF
    package_id,
    game_id,
    package_version,
    package_schema_version,
    payload_json,
    payload_hash,
    published_at_utc,
    downloaded_at_utc
ON local_game_packages
BEGIN
    SELECT RAISE(ABORT, 'Local GamePackage immutable fields cannot be changed.');
END;
