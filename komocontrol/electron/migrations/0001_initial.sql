CREATE TABLE local_schema_migrations (
    migration_id TEXT PRIMARY KEY,
    applied_at_utc TEXT NOT NULL CHECK (length(applied_at_utc) >= 20),
    checksum TEXT NOT NULL CHECK (length(checksum) = 64)
) STRICT;

CREATE TABLE device_identity (
    singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
    device_id TEXT NOT NULL UNIQUE CHECK (length(device_id) = 36),
    created_at_utc TEXT NOT NULL CHECK (length(created_at_utc) >= 20)
) STRICT;
