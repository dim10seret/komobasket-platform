import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalAppUser } from "@/lib/app-user-identity";
import type { D1DatabaseBinding, D1PreparedStatement, R2BucketBinding } from "@/types/cloudflare";

const mocks = vi.hoisted(() => ({ phaseAccess: vi.fn(), competition: vi.fn(), cloudflare: vi.fn(),
  imageContext: vi.fn(), imageOutput: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: mocks.imageContext }));
vi.mock("@/lib/platform-authorization", () => ({ requirePhaseAccessWithDb: mocks.phaseAccess }));
vi.mock("@/services/public-mobile-competition.service", () => ({ readCompetitionDetailWithDb: mocks.competition }));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: mocks.cloudflare }));

import { MvpPublicationError, mvpPresentationRevision, normalizeMvpPresentation, readPublicMvpPhotoWithDb,
  updateMvpPresentationWithDb as saveMvpPresentationWithDb, validateMvpPhoto } from "./mvp-publication.service";
import { GET as readPhoto } from "@/app/api/public/v1/mvp-media/[contestId]/[filename]/route";
import { GET as readGenericNewsImage } from "@/app/api/news/images/[...key]/route";
import { platformMvpErrorResponse, platformMvpPresentationOperation } from "./platform-mvp-operation";

const actor: CanonicalAppUser = { userId: "admin-a", email: "admin@example.test", displayName: "Admin",
  isSuperAdmin: false, isLocal: false };
const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4n2YMAAQAAZnapz5oAAAAAElFTkSuQmCC", "base64"));
const malformedWebp = Uint8Array.from([
  82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32,
  10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);
let jpeg: Uint8Array, webp: Uint8Array, losslessWebp: Uint8Array, extendedWebp: Uint8Array, avif: Uint8Array;
let largerPng: Uint8Array, largerJpeg: Uint8Array, largerWebp: Uint8Array;
beforeAll(async () => {
  jpeg = new Uint8Array(await sharp(png).jpeg().toBuffer());
  webp = new Uint8Array(await sharp(png).webp().toBuffer());
  losslessWebp = new Uint8Array(await sharp(png).webp({ lossless: true }).toBuffer());
  extendedWebp = new Uint8Array(await sharp({ create: { width: 1, height: 1, channels: 4,
    background: { r: 20, g: 30, b: 40, alpha: 0.5 } } }).webp().toBuffer());
  avif = new Uint8Array(await sharp(png).avif().toBuffer());
  largerPng = new Uint8Array(await sharp({ create: { width: 80, height: 50, channels: 4,
    background: { r: 20, g: 30, b: 40, alpha: 0.5 } } }).png().toBuffer());
  largerJpeg = new Uint8Array(await sharp(largerPng).jpeg().toBuffer());
  largerWebp = new Uint8Array(await sharp(largerPng).webp({ lossless: true }).toBuffer());
});
const text = { photoCaption: "A caption", bodyText: "A description", sponsorName: "A sponsor", giftDescription: "A gift" };
const file = (bytes = png, type = "image/png") => new File([new Uint8Array(bytes)], "synthetic.png", { type });

let sqlite: DatabaseSync;
let db: D1DatabaseBinding;
let objects: Map<string, { body: Uint8Array; type: string }>;
let bucket: R2BucketBinding;
function prepared(sql: string, args: unknown[] = []): D1PreparedStatement {
  return { bind: (...values) => prepared(sql, values),
    first: async <T,>() => (sqlite.prepare(sql).get(...args) ?? null) as T | null,
    all: async <T,>() => ({ results: sqlite.prepare(sql).all(...args) as T[] }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  };
}
const row = (id = "final") => sqlite.prepare("SELECT * FROM mvp_contests WHERE id=?").get(id) as Record<string, unknown>;
const photo = () => file();
const revision = (id = "final") => mvpPresentationRevision(row(id) as Parameters<typeof mvpPresentationRevision>[0]);
async function updateMvpPresentationWithDb(database: D1DatabaseBinding, storage: R2BucketBinding | undefined,
  user: CanonicalAppUser | null, organizationId: string, contestId: string,
  input: Omit<Parameters<typeof saveMvpPresentationWithDb>[5], "presentationRevision"> & { presentationRevision?: unknown }) {
  return saveMvpPresentationWithDb(database, storage, user, organizationId, contestId,
    { ...input, presentationRevision: input.presentationRevision ?? await revision(contestId) });
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE league_competitions(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL);
    CREATE TABLE league_phases(id TEXT PRIMARY KEY,competition_id TEXT NOT NULL);
    CREATE TABLE mvp_contests(id TEXT PRIMARY KEY,phase_id TEXT NOT NULL,status TEXT NOT NULL,
      selection_method TEXT NOT NULL,winner_player_id TEXT,finalized_at INTEGER,photo_asset_key TEXT,
      photo_caption TEXT,body_text TEXT,sponsor_name TEXT,gift_description TEXT,updated_at INTEGER NOT NULL);
    CREATE TABLE league_audit_log(id TEXT PRIMARY KEY,actor_email TEXT,action TEXT NOT NULL,
      entity_type TEXT,entity_id TEXT,details_json TEXT,created_at TEXT);
    INSERT INTO league_competitions VALUES ('competition-a','org-a'),('competition-b','org-b');
    INSERT INTO league_phases VALUES ('phase-a','competition-a'),('phase-b','competition-b');
    INSERT INTO mvp_contests(id,phase_id,status,selection_method,winner_player_id,finalized_at,updated_at)
      VALUES ('final','phase-a','finalized','app_poll','player-a',100,100),
        ('open','phase-a','open','app_poll',NULL,NULL,100),
        ('tie','phase-a','tie_requires_resolution','app_poll',NULL,NULL,100),
        ('foreign','phase-b','finalized','app_poll','player-b',100,100);`);
  db = { prepare: (sql) => prepared(sql), batch: async (statements) => {
    sqlite.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push(await statement.run());
      sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  objects = new Map();
  bucket = { get: async (key) => { const found = objects.get(key);
    if (!found) return null;
    return { body: new ReadableStream({ start(controller) { controller.enqueue(found.body); controller.close(); } }),
      httpEtag: "synthetic-etag", httpMetadata: { contentType: found.type } };
  }, put: async (key, value, options) => { objects.set(key, { body: new Uint8Array(value),
    type: options?.httpMetadata?.contentType ?? "" }); }, delete: async (key) => { objects.delete(key); } };
  mocks.phaseAccess.mockImplementation(async (_db, user: CanonicalAppUser, phaseId: string) => {
    if (user?.userId === "viewer") throw new Error("FORBIDDEN");
    return { organizationId: phaseId === "phase-b" ? "org-b" : "org-a" };
  });
  mocks.competition.mockImplementation(async (_db, competitionId: string) => ({
    organizationId: competitionId === "competition-b" ? "org-b" : "org-a",
    tournamentGroups: [{ phaseIds: [competitionId === "competition-b" ? "phase-b" : "phase-a"] }],
  }));
  mocks.cloudflare.mockResolvedValue({ NEWS_DB: db, NEWS_IMAGES: bucket, MVP_PUBLIC_READ_ENABLED: "enabled" });
  mocks.imageOutput.mockImplementation(async (source: ReadableStream, options: {
    format: string; quality: number; anim: boolean }) => {
    if (options.format !== "image/webp" || options.anim !== false) throw new Error("Unexpected image output");
    const input = await new Response(source).arrayBuffer();
    const encoded = await sharp(input).webp({ quality: options.quality }).toBuffer();
    return { response: () => new Response(new Uint8Array(encoded).buffer as ArrayBuffer,
      { headers: { "Content-Type": "image/webp" } }) };
  });
  mocks.imageContext.mockResolvedValue({ env: { IMAGES: { input: (source: ReadableStream) => ({
    output: (options: { format: string; quality: number; anim: boolean }) =>
      mocks.imageOutput(source, options),
  }) } } });
});
afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

describe("MVP3B publication enrichment", () => {
  it("edits finalized text without changing the winner, finalization or candidate data", async () => {
    const result = await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", text);
    expect(result).toMatchObject({ contestId: "final", photoUrl: null, sponsorName: "A sponsor" });
    expect(row()).toMatchObject({ winner_player_id: "player-a", finalized_at: 100, body_text: "A description",
      photo_caption: "A caption", sponsor_name: "A sponsor", gift_description: "A gift" });
    expect(sqlite.prepare("SELECT action FROM league_audit_log").get()).toEqual({ action: "mvp_presentation_updated" });
    await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", { ...text, bodyText: "" });
    expect(row().body_text).toBeNull();
  });

  it("accepts the shared Platform multipart operation with optional fields", async () => {
    const form = new FormData();
    form.set("contestId", "final");
    form.set("presentationRevision", await revision());
    for (const [key, value] of Object.entries(text)) form.set(key, value);
    const response = await platformMvpPresentationOperation(db, bucket, actor, "org-a", form);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ bodyText: "A description", photoUrl: null });
    expect(row().sponsor_name).toBe("A sponsor");
  });

  it("rejects a stale second manager without overwriting a newer caption or partly saving a gift", async () => {
    const original = await revision();
    await saveMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
      ...text, photoCaption: "Manager A caption", giftDescription: "", presentationRevision: original,
    });
    const afterA = row();
    const form = new FormData();
    form.set("contestId", "final"); form.set("presentationRevision", original);
    form.set("photoCaption", ""); form.set("bodyText", "A description");
    form.set("sponsorName", "A sponsor"); form.set("giftDescription", "Manager B gift");
    let conflict: unknown;
    try { await platformMvpPresentationOperation(db, bucket, actor, "org-a", form); }
    catch (error) { conflict = error; }
    expect(conflict).toMatchObject({ code: "PRESENTATION_CONFLICT", status: 409 });
    const response = platformMvpErrorResponse(conflict);
    expect(response?.status).toBe(409);
    expect(await response?.json()).toEqual({ error: "PRESENTATION_CONFLICT" });
    expect(row()).toEqual(afterA);
    expect(objects.size).toBe(0);
    await saveMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
      ...text, photoCaption: "Manager A caption", giftDescription: "Manager B gift",
      presentationRevision: await revision(),
    });
    expect(row()).toMatchObject({ photo_caption: "Manager A caption", gift_description: "Manager B gift",
      winner_player_id: "player-a", finalized_at: 100 });
  });

  it("uses a monotonic revision for two rapid updates even when the wall clock has not advanced", async () => {
    sqlite.prepare("UPDATE mvp_contests SET updated_at=unixepoch('now')+1000 WHERE id='final'").run();
    const original = await revision();
    const before = Number(row().updated_at);
    await saveMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
      ...text, presentationRevision: original,
    });
    expect(Number(row().updated_at)).toBe(before + 1);
    const next = await revision();
    expect(next).not.toBe(original);
    await expect(saveMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
      ...text, giftDescription: "stale", presentationRevision: original,
    })).rejects.toMatchObject({ code: "PRESENTATION_CONFLICT" });
    await saveMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
      ...text, giftDescription: "current", presentationRevision: next,
    });
    expect(Number(row().updated_at)).toBe(before + 2);
    expect(row().gift_description).toBe("current");
  });

  it("allows only one concurrent save from the same original presentation", async () => {
    const original = await revision();
    const outcome = await Promise.allSettled([
      saveMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
        ...text, photoCaption: "A", giftDescription: "", presentationRevision: original,
      }),
      saveMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
        ...text, photoCaption: "", giftDescription: "B", presentationRevision: original,
      }),
    ]);
    expect(outcome.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcome.filter((item) => item.status === "rejected")
      .map((item) => (item as PromiseRejectedResult).reason.code)).toEqual(["PRESENTATION_CONFLICT"]);
    expect(["A", null]).toContain(row().photo_caption);
    expect(["B", null]).toContain(row().gift_description);
    expect(Number(row().photo_caption !== null) + Number(row().gift_description !== null)).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM league_audit_log").get()).toEqual({ n: 1 });
  });

  it("rejects stale photo replacement and removal before uploading anything", async () => {
    await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", { ...text, photo: photo() });
    const originalKey = String(row().photo_asset_key);
    const stale = await revision();
    await saveMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
      ...text, photoCaption: "New caption", presentationRevision: stale,
    });
    for (const attempted of [{ photo: file(largerJpeg, "image/jpeg") }, { removePhoto: true }]) {
      await expect(saveMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
        ...text, ...attempted, presentationRevision: stale,
      })).rejects.toMatchObject({ code: "PRESENTATION_CONFLICT" });
      expect(row()).toMatchObject({ photo_asset_key: originalKey, photo_caption: "New caption" });
      expect(objects.size).toBe(1);
    }
    expect(await readPublicMvpPhotoWithDb(db, "final", originalKey.split("/").at(-1)!)).toBe(originalKey);
  });

  it("rejects a photo race at the atomic write and retains the active photo", async () => {
    await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", { ...text, photo: photo() });
    const originalKey = String(row().photo_asset_key);
    const current = await revision();
    const racingDb = { ...db, batch: async (statements: Parameters<NonNullable<D1DatabaseBinding["batch"]>>[0]) => {
      sqlite.prepare("UPDATE mvp_contests SET photo_caption='Concurrent caption',updated_at=updated_at+1 WHERE id='final'").run();
      return db.batch(statements);
    } };
    await expect(saveMvpPresentationWithDb(racingDb, bucket, actor, "org-a", "final", {
      ...text, photo: file(largerJpeg, "image/jpeg"), presentationRevision: current,
    })).rejects.toMatchObject({ code: "PRESENTATION_CONFLICT", status: 409 });
    expect(row()).toMatchObject({ photo_asset_key: originalKey, photo_caption: "Concurrent caption",
      winner_player_id: "player-a", finalized_at: 100 });
    expect(objects.size).toBe(2);
    expect(await readPublicMvpPhotoWithDb(db, "final", originalKey.split("/").at(-1)!)).toBe(originalKey);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM league_audit_log").get()).toEqual({ n: 1 });
  });

  it("requires a valid original revision rather than silently using the latest row", async () => {
    await expect(saveMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
      ...text, presentationRevision: null,
    })).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(row().photo_caption).toBeNull();
  });

  it.each(["open", "tie"])("rejects unfinished %s contests", async (id) => {
    await expect(updateMvpPresentationWithDb(db, bucket, actor, "org-a", id, text))
      .rejects.toMatchObject({ code: "CONTEST_NOT_FINALIZED" });
    expect(objects.size).toBe(0);
  });

  it("enforces manager and canonical organization ownership", async () => {
    await expect(updateMvpPresentationWithDb(db, bucket, actor, "org-b", "final", text))
      .rejects.toMatchObject({ code: "CONTEST_NOT_FOUND" });
    await expect(updateMvpPresentationWithDb(db, bucket, { ...actor, userId: "viewer" }, "org-a", "final", text))
      .rejects.toThrow("FORBIDDEN");
    expect(row().body_text).toBeNull();
  });

  it("stores a validated versioned photo, replaces it and rejects the old public reference", async () => {
    const first = await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", { ...text, photo: photo() });
    const firstKey = String(row().photo_asset_key);
    expect(firstKey).toMatch(/^mvp\/org-a\/final\/[a-f0-9-]+\.webp$/);
    expect(await readPublicMvpPhotoWithDb(db, "final", firstKey.split("/").at(-1)!)).toBe(firstKey);
    const second = await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", { ...text, photo: photo() });
    expect(second.photoUrl).not.toBe(first.photoUrl);
    expect(objects.size).toBe(2);
    expect(await readPublicMvpPhotoWithDb(db, "final", firstKey.split("/").at(-1)!)).toBeNull();
    expect(row()).toMatchObject({ winner_player_id: "player-a", finalized_at: 100 });
    const current = await readPhoto(new Request("https://example.test/photo"),
      { params: Promise.resolve({ contestId: "final", filename: String(row().photo_asset_key).split("/").at(-1)! }) });
    expect(current.status).toBe(200);
    expect(current.headers.get("Content-Type")).toBe("image/webp");
    expect(current.headers.get("Cache-Control")).toBe("no-store");
    const generic = await readGenericNewsImage(new Request("https://example.test/news"),
      { params: Promise.resolve({ key: String(row().photo_asset_key).split("/") }) });
    expect(generic.status).toBe(404);
  });

  it("removes the current photo without deleting the stored object", async () => {
    await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", { ...text, photo: photo() });
    const result = await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", { ...text, removePhoto: true });
    expect(result.photoUrl).toBeNull();
    expect(row().photo_asset_key).toBeNull();
    expect(objects.size).toBe(1);
  });

  it("rejects oversized, empty, unsupported and malformed image content", async () => {
    expect(() => validateMvpPhoto(new Uint8Array(0), "image/png")).toThrow(MvpPublicationError);
    expect(() => validateMvpPhoto(new Uint8Array(5 * 1024 * 1024 + 1), "image/png"))
      .toThrowError(expect.objectContaining({ code: "IMAGE_TOO_LARGE" }));
    expect(() => validateMvpPhoto(png, "image/svg+xml")).toThrow(MvpPublicationError);
    expect(() => validateMvpPhoto(new TextEncoder().encode("<html>unsafe</html>"), "image/png"))
      .toThrow(MvpPublicationError);
    expect(() => validateMvpPhoto(png.subarray(0, 20), "image/png")).toThrow(MvpPublicationError);
    expect(validateMvpPhoto(png, "image/png")).toBe("png");
  });

  it("rejects the confirmed 30-byte RIFF/VP8 file with no image payload", () => {
    expect(() => validateMvpPhoto(malformedWebp, "image/webp"))
      .toThrowError(expect.objectContaining({ code: "INVALID_IMAGE" }));
  });

  it("accepts real decodable PNG, JPEG, VP8, VP8L, VP8X and AVIF", async () => {
    for (const [bytes, mime, extension] of [
      [png, "image/png", "png"], [jpeg, "image/jpeg", "jpg"],
      [webp, "image/webp", "webp"], [losslessWebp, "image/webp", "webp"],
      [extendedWebp, "image/webp", "webp"],
      [avif, "image/avif", "avif"],
    ] as const) {
      expect(validateMvpPhoto(bytes, mime)).toBe(extension);
      const result = await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
        ...text, photo: file(bytes, mime),
      });
      expect(result.photoUrl).toContain(".webp");
      const stored = objects.get(String(row().photo_asset_key));
      expect(stored?.type).toBe("image/webp");
      expect(stored?.body.subarray(0, 4)).toEqual(new TextEncoder().encode("RIFF"));
      expect((await sharp(stored!.body).metadata()).format).toBe("webp");
      if (mime !== "image/webp") expect(stored?.body).not.toEqual(bytes);
    }
  });

  it("stores one full-size re-encoded WebP without changing aspect ratio or transparency", async () => {
    for (const [bytes, mime] of [
      [largerPng, "image/png"], [largerJpeg, "image/jpeg"],
      [largerWebp, "image/webp"],
    ] as const) {
      await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
        ...text, photo: file(bytes, mime),
      });
      const stored = objects.get(String(row().photo_asset_key));
      expect(stored?.type).toBe("image/webp");
      expect(stored?.body).not.toEqual(bytes);
      const metadata = await sharp(stored!.body).metadata();
      expect(metadata).toMatchObject({ format: "webp", width: 80, height: 50 });
      if (mime === "image/png") expect(metadata.hasAlpha).toBe(true);
    }
    expect(mocks.imageOutput).toHaveBeenCalledTimes(3);
    expect(mocks.imageOutput).toHaveBeenCalledWith(expect.any(ReadableStream),
      { format: "image/webp", quality: 85, anim: false });
  });

  it.each([
    ["empty", new Uint8Array(), "image/webp"],
    ["wrong MIME", png, "image/png"],
    ["truncated WebP", malformedWebp, "image/webp"],
  ] as const)("rejects %s transformed output before R2 and D1 writes", async (_label, output, mime) => {
    mocks.imageOutput.mockResolvedValue({ response: () => new Response(output.buffer as ArrayBuffer,
      { headers: { "Content-Type": mime } }) });
    await expect(updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
      ...text, photo: photo(),
    })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    expect(objects.size).toBe(0);
    expect(row().photo_asset_key).toBeNull();
  });

  it("fails closed when IMAGES processing fails", async () => {
    mocks.imageOutput.mockRejectedValue(new Error("IMAGES failed"));
    await expect(updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
      ...text, photo: photo(),
    })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    expect(objects.size).toBe(0);
    expect(row().photo_asset_key).toBeNull();
  });

  it("rejects truncated, mis-sized, incomplete and MIME-mismatched WebP before R2 writes", async () => {
    const badSize = webp.slice(); badSize[4]++;
    const missingImage = webp.slice(0, 20); new DataView(missingImage.buffer).setUint32(4, 12, true);
    const badChunk = webp.slice(); new DataView(badChunk.buffer).setUint32(16, webp.length, true);
    const badPadding = new Uint8Array(webp.length + 10);
    badPadding.set(webp);
    badPadding.set([88, 77, 80, 32, 1, 0, 0, 0, 0, 1], webp.length);
    new DataView(badPadding.buffer).setUint32(4, badPadding.length - 8, true);
    for (const [bytes, mime] of [
      [malformedWebp, "image/webp"], [webp.subarray(0, webp.length - 1), "image/webp"],
      [badSize, "image/webp"], [missingImage, "image/webp"], [badChunk, "image/webp"],
      [badPadding, "image/webp"],
      [webp, "image/png"],
    ] as const) {
      await expect(updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
        ...text, photo: file(bytes, mime),
      })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
      expect(row().photo_asset_key).toBeNull();
      expect(objects.size).toBe(0);
    }
  });

  it("rejects corrupted image payloads after format checks without changing a saved photo", async () => {
    await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", { ...text, photo: file(webp, "image/webp") });
    const originalKey = row().photo_asset_key;
    const corruptedPng = png.slice();
    corruptedPng[43] ^= 0xff;
    const corruptedJpeg = jpeg.slice();
    corruptedJpeg.fill(0, 24, corruptedJpeg.length - 2);
    for (const [bytes, mime] of [
      [corruptedPng, "image/png"], [corruptedJpeg, "image/jpeg"],
      [new TextEncoder().encode("<svg></svg>"), "image/svg+xml"],
      [new TextEncoder().encode("<html></html>"), "text/html"],
    ] as const) {
      await expect(updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
        ...text, photo: file(bytes, mime),
      })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
      expect(row().photo_asset_key).toBe(originalKey);
      expect(objects.size).toBe(1);
    }
  });

  it("fails closed if the Workers image decoder is missing", async () => {
    mocks.imageContext.mockResolvedValue({ env: {} });
    await expect(updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", {
      ...text, photo: file(webp, "image/webp"),
    })).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(objects.size).toBe(0);
    expect(row().photo_asset_key).toBeNull();
  });

  it("does not update D1 when upload fails, and documents an orphan if D1 fails after upload", async () => {
    const failedBucket = { ...bucket, put: async () => { throw new Error("R2 down"); } };
    await expect(updateMvpPresentationWithDb(db, failedBucket, actor, "org-a", "final", { ...text, photo: photo() }))
      .rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(row().photo_asset_key).toBeNull();
    const failedDb = { ...db, batch: async () => { throw new Error("D1 down"); } };
    await expect(updateMvpPresentationWithDb(failedDb, bucket, actor, "org-a", "final", { ...text, photo: photo() }))
      .rejects.toThrow("D1 down");
    expect(row().photo_asset_key).toBeNull();
    expect(objects.size).toBe(1);
  });

  it("preserves the published photo if a replacement D1 update fails", async () => {
    await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", { ...text, photo: photo() });
    const originalKey = String(row().photo_asset_key);
    const failedDb = { ...db, batch: async () => { throw new Error("D1 down"); } };
    await expect(updateMvpPresentationWithDb(failedDb, bucket, actor, "org-a", "final", {
      ...text, photo: file(largerJpeg, "image/jpeg"),
    })).rejects.toThrow("D1 down");
    expect(row()).toMatchObject({ photo_asset_key: originalKey, winner_player_id: "player-a", finalized_at: 100 });
    expect(await readPublicMvpPhotoWithDb(db, "final", originalKey.split("/").at(-1)!)).toBe(originalKey);
    expect(objects.size).toBe(2);
  });

  it("continues serving a previously stored PNG with its original Content-Type", async () => {
    const key = "mvp/org-a/final/00000000-0000-4000-8000-000000000001.png";
    sqlite.prepare("UPDATE mvp_contests SET photo_asset_key=? WHERE id='final'").run(key);
    objects.set(key, { body: png, type: "image/png" });
    const response = await readPhoto(new Request("https://example.test/photo"),
      { params: Promise.resolve({ contestId: "final", filename: key.split("/").at(-1)! }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("validates and normalizes optional plain text without allowing HTML markup", () => {
    expect(normalizeMvpPresentation({ photoCaption: "  ", bodyText: "  Note  ", sponsorName: "", giftDescription: "" }))
      .toMatchObject({ photoCaption: null, bodyText: "Note", sponsorName: null });
    expect(() => normalizeMvpPresentation({ ...text, bodyText: "<script>alert(1)</script>" }))
      .toThrow(MvpPublicationError);
    expect(() => normalizeMvpPresentation({ ...text, sponsorName: "x".repeat(161) }))
      .toThrow(MvpPublicationError);
  });

  it("hides media if public reads are disabled or the competition is unpublished", async () => {
    await updateMvpPresentationWithDb(db, bucket, actor, "org-a", "final", { ...text, photo: photo() });
    const filename = String(row().photo_asset_key).split("/").at(-1)!;
    mocks.cloudflare.mockResolvedValue({ NEWS_DB: db, NEWS_IMAGES: bucket });
    expect((await readPhoto(new Request("https://example.test/photo"),
      { params: Promise.resolve({ contestId: "final", filename }) })).status).toBe(404);
    mocks.cloudflare.mockResolvedValue({ NEWS_DB: db, NEWS_IMAGES: bucket, MVP_PUBLIC_READ_ENABLED: "enabled" });
    mocks.competition.mockRejectedValue(new Error("Unpublished"));
    expect((await readPhoto(new Request("https://example.test/photo"),
      { params: Promise.resolve({ contestId: "final", filename }) })).status).toBe(404);
  });
});
