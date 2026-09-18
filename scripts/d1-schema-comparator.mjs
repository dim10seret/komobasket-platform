// Audit-only helper. Use this same comparison for backup, production and rehearsal.
const schemaTypes = new Set(["table", "index", "view", "trigger"]);

function internalName(name) {
  const normalized = name.toLowerCase();
  // _cf_KV is D1's documented reserved storage table. Do not ignore all _cf_*.
  return normalized === "_cf_kv" || normalized.startsWith("sqlite_");
}

export function isInternalD1SchemaObject(object) {
  return internalName(object.name) || internalName(object.tbl_name);
}

function partitionSchema(objects) {
  const application = new Map();
  const excluded = [];
  for (const object of objects) {
    if (!schemaTypes.has(object.type) || typeof object.name !== "string" ||
        typeof object.tbl_name !== "string" ||
        (typeof object.sql !== "string" && object.sql !== null)) {
      throw new Error("INVALID_SCHEMA_OBJECT");
    }
    if (isInternalD1SchemaObject(object)) {
      excluded.push({ type: object.type, name: object.name });
      continue;
    }
    const key = JSON.stringify([object.type, object.name]);
    if (application.has(key)) throw new Error("DUPLICATE_SCHEMA_OBJECT");
    application.set(key, object);
  }
  return { application, excluded };
}

export function compareApplicationSchemas(baseline, actual, { approvedAdditions = [] } = {}) {
  const before = partitionSchema(baseline);
  const after = partitionSchema(actual);
  const additions = partitionSchema(approvedAdditions);
  if (additions.excluded.length) throw new Error("INTERNAL_OBJECT_CANNOT_BE_APPROVED_ADDITION");
  const expected = new Map(before.application);
  for (const [key, object] of additions.application) {
    if (expected.has(key)) throw new Error("APPROVED_ADDITION_ALREADY_IN_BASELINE");
    expected.set(key, object);
  }
  const missing = [];
  const unexpected = [];
  const changed = [];
  const intentionalAdditions = [];
  for (const [key, object] of expected) {
    const found = after.application.get(key);
    if (!found) missing.push(object);
    else if (object.tbl_name !== found.tbl_name || object.sql !== found.sql) {
      changed.push({ expected: object, actual: found });
    } else if (additions.application.has(key)) intentionalAdditions.push(found);
  }
  for (const [key, object] of after.application) {
    if (!expected.has(key)) unexpected.push(object);
  }
  return {
    status: missing.length || unexpected.length || changed.length ? "FAIL" : "PASS",
    missing,
    unexpected,
    changed,
    intentionalAdditions,
    excludedBaseline: before.excluded,
    excludedActual: after.excluded,
  };
}
