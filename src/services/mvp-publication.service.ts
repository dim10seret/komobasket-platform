import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { requirePhaseAccessWithDb } from "@/lib/platform-authorization";
import { readCompetitionDetailWithDb } from "@/services/public-mobile-competition.service";
import type { D1DatabaseBinding, R2BucketBinding } from "@/types/cloudflare";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PROCESSED_PHOTO_BYTES = 10 * 1024 * 1024;
const KEY_ID = /^[A-Za-z0-9_-]{1,160}$/;
type TextInput = { photoCaption: unknown; bodyText: unknown; sponsorName: unknown; giftDescription: unknown };
type PresentationState = { photo_asset_key: string | null; photo_caption: string | null; body_text: string | null;
  sponsor_name: string | null; gift_description: string | null; updated_at: number };
type PublicationRow = { id: string; phase_id: string; status: string; winner_player_id: string | null;
  finalized_at: number | null } & PresentationState;

export class MvpPublicationError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INVALID_IMAGE" | "IMAGE_TOO_LARGE" | "STORAGE_UNAVAILABLE" |
    "CONTEST_NOT_FOUND" | "CONTEST_NOT_FINALIZED" | "CONTEST_CONFLICT" | "PRESENTATION_CONFLICT", readonly status: number) {
    super(code); this.name = "MvpPublicationError";
  }
}

function plainText(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.length > maximum * 2) throw new MvpPublicationError("INVALID_INPUT", 400);
  const normalized = value.trim();
  if (normalized.length > maximum || /<[^>]*>/.test(normalized)) throw new MvpPublicationError("INVALID_INPUT", 400);
  return normalized || null;
}

export function normalizeMvpPresentation(input: TextInput) {
  return {
    photoCaption: plainText(input.photoCaption, 200), bodyText: plainText(input.bodyText, 5000),
    sponsorName: plainText(input.sponsorName, 160), giftDescription: plainText(input.giftDescription, 500),
  };
}

/** Opaque revision of exactly the presentation that an editor loaded; no R2 key is exposed. */
export async function mvpPresentationRevision(state: PresentationState): Promise<string> {
  const snapshot = JSON.stringify([state.updated_at, state.photo_asset_key, state.photo_caption,
    state.body_text, state.sponsor_name, state.gift_description]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readU32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

const pngCrcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function validPng(bytes: Uint8Array) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).every((value, index) =>
    value === [137, 80, 78, 71, 13, 10, 26, 10][index])) return false;
  let offset = 8, hasHeader = false, hasData = false;
  while (offset + 12 <= bytes.length) {
    const size = readU32(bytes, offset);
    if (size > bytes.length - offset - 12) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for (let index = offset + 4; index < offset + 8 + size; index++)
      crc = pngCrcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    if (((crc ^ 0xffffffff) >>> 0) !== readU32(bytes, offset + 8 + size)) return false;
    if (offset === 8) {
      if (type !== "IHDR" || size !== 13 || !readU32(bytes, offset + 8) || !readU32(bytes, offset + 12)) return false;
      hasHeader = true;
    }
    if (type === "IDAT") hasData = true;
    offset += size + 12;
    if (type === "IEND") return hasHeader && hasData && size === 0 && offset === bytes.length;
  }
  return false;
}

function validJpeg(bytes: Uint8Array) {
  if (bytes.length < 32 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;
  let offset = 2, hasFrame = false;
  while (offset + 4 <= bytes.length - 2) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) return hasFrame;
    if (marker === 0xd9 || marker === 0x00 || marker === undefined) return false;
    const size = (bytes[offset] << 8) | bytes[offset + 1];
    if (size < 2 || offset + size > bytes.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      if (size < 8 || !((bytes[offset + 3] << 8) | bytes[offset + 4]) ||
          !((bytes[offset + 5] << 8) | bytes[offset + 6])) return false;
      hasFrame = true;
    }
    offset += size;
  }
  return false;
}

function validWebp(bytes: Uint8Array) {
  if (bytes.length < 30 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
      String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.length - 8) return false;
  let offset = 12;
  let first = "", image = false, animation = false;
  while (offset + 8 <= bytes.length) {
    const kind = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (size > bytes.length - start || (size & 1) > bytes.length - start - size ||
        ((size & 1) !== 0 && bytes[start + size] !== 0)) return false;
    if (!first) {
      first = kind;
      if (kind !== "VP8 " && kind !== "VP8L" && kind !== "VP8X") return false;
    }
    if (kind === "VP8 ") {
      const partitionSize = ((bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16)) >>> 5);
      if (size < 11 || (bytes[start] & 1) !== 0 ||
          bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a ||
          !(view.getUint16(start + 6, true) & 0x3fff) ||
          !(view.getUint16(start + 8, true) & 0x3fff) || !partitionSize ||
          partitionSize > size - 10 || image) return false;
      image = true;
    } else if (kind === "VP8L") {
      if (size < 6 || bytes[start] !== 0x2f || (bytes[start + 4] & 0xe0) !== 0 || image) return false;
      image = true;
    } else if (kind === "VP8X") {
      if (offset !== 12 || size !== 10 || bytes[start + 1] !== 0 || bytes[start + 2] !== 0 ||
          bytes[start + 3] !== 0) return false;
    } else if (kind === "ANMF") {
      if (first !== "VP8X" || size <= 16) return false;
      animation = true;
    }
    offset = start + size + (size & 1);
  }
  return offset === bytes.length && (first === "VP8X" ? image || animation : image);
}

/** Small structural checks in addition to MIME matching; SVG and HTML have no accepted signature. */
export function validateMvpPhoto(bytes: Uint8Array, mime: string): "jpg" | "png" | "webp" | "avif" {
  if (!bytes.length) throw new MvpPublicationError("INVALID_IMAGE", 400);
  if (bytes.length > MAX_PHOTO_BYTES) throw new MvpPublicationError("IMAGE_TOO_LARGE", 413);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (mime === "image/png" && validPng(bytes)) return "png";
  if (mime === "image/jpeg" && validJpeg(bytes)) return "jpg";
  if (mime === "image/webp" && validWebp(bytes)) return "webp";
  if (mime === "image/avif" && bytes.length >= 40) {
    let offset = 0, branded = false, meta = false, media = false;
    while (offset + 8 <= bytes.length) {
      const size = readU32(bytes, offset);
      if (size < 8 || offset + size > bytes.length) break;
      const kind = ascii(offset + 4, 4);
      if (kind === "ftyp" && size >= 16 && ["avif", "avis"].includes(ascii(offset + 8, 4))) branded = true;
      if (kind === "meta") meta = true;
      if (kind === "mdat" && size > 8) media = true;
      offset += size;
    }
    if (offset === bytes.length && branded && meta && media) return "avif";
  }
  throw new MvpPublicationError("INVALID_IMAGE", 400);
}

/** Store only the decoded and re-encoded output of the Workers Images binding. */
async function encodeMvpPhoto(bytes: Uint8Array): Promise<ArrayBuffer> {
  let images: CloudflareEnv["IMAGES"];
  try { images = (await getCloudflareContext({ async: true })).env.IMAGES; }
  catch { throw new MvpPublicationError("STORAGE_UNAVAILABLE", 503); }
  if (!images) throw new MvpPublicationError("STORAGE_UNAVAILABLE", 503);
  try {
    const source = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes); controller.close();
    } });
    const result = await images.input(source).output({ format: "image/webp", quality: 85, anim: false });
    const response = result.response();
    if (response.headers.get("Content-Type") !== "image/webp")
      throw new MvpPublicationError("INVALID_IMAGE", 400);
    const encoded = await response.arrayBuffer();
    if (!encoded.byteLength || !validWebp(new Uint8Array(encoded)))
      throw new MvpPublicationError("INVALID_IMAGE", 400);
    if (encoded.byteLength > MAX_PROCESSED_PHOTO_BYTES)
      throw new MvpPublicationError("IMAGE_TOO_LARGE", 413);
    return encoded;
  } catch (error) {
    if (error instanceof MvpPublicationError) throw error;
    throw new MvpPublicationError("INVALID_IMAGE", 400);
  }
}

export function mvpPhotoUrl(contestId: string, key: string | null) {
  if (!key) return null;
  const filename = key.split("/").at(-1);
  return filename ? `/api/public/v1/mvp-media/${encodeURIComponent(contestId)}/${encodeURIComponent(filename)}` : null;
}

export async function updateMvpPresentationWithDb(db: D1DatabaseBinding, bucket: R2BucketBinding | undefined,
  actor: CanonicalAppUser | null, organizationId: string, contestId: string,
  input: TextInput & { presentationRevision: unknown; photo?: File | null; removePhoto?: boolean }) {
  if (!KEY_ID.test(organizationId) || !KEY_ID.test(contestId) || (input.photo && input.removePhoto))
    throw new MvpPublicationError("INVALID_INPUT", 400);
  const text = normalizeMvpPresentation(input);
  const existing = await db.prepare(`SELECT id,phase_id,status,winner_player_id,finalized_at,photo_asset_key,
    photo_caption,body_text,sponsor_name,gift_description,updated_at
    FROM mvp_contests WHERE id=?`).bind(contestId).first<PublicationRow>();
  if (!existing) throw new MvpPublicationError("CONTEST_NOT_FOUND", 404);
  const access = await requirePhaseAccessWithDb(db, actor, existing.phase_id, "manage");
  if (access.organizationId !== organizationId) throw new MvpPublicationError("CONTEST_NOT_FOUND", 404);
  if (existing.status !== "finalized" || !existing.winner_player_id || !existing.finalized_at)
    throw new MvpPublicationError("CONTEST_NOT_FINALIZED", 409);
  if (typeof input.presentationRevision !== "string" || !/^[a-f0-9]{64}$/.test(input.presentationRevision))
    throw new MvpPublicationError("INVALID_INPUT", 400);
  if (input.presentationRevision !== await mvpPresentationRevision(existing))
    throw new MvpPublicationError("PRESENTATION_CONFLICT", 409);
  let key = input.removePhoto ? null : existing.photo_asset_key;
  if (input.photo) {
    if (!bucket) throw new MvpPublicationError("STORAGE_UNAVAILABLE", 503);
    if (input.photo.size > MAX_PHOTO_BYTES) throw new MvpPublicationError("IMAGE_TOO_LARGE", 413);
    const bytes = new Uint8Array(await input.photo.arrayBuffer());
    validateMvpPhoto(bytes, input.photo.type);
    const encoded = await encodeMvpPhoto(bytes);
    key = `mvp/${organizationId}/${contestId}/${crypto.randomUUID()}.webp`;
    try {
      await bucket.put(key, encoded, { httpMetadata: {
        contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable",
      } });
    } catch { throw new MvpPublicationError("STORAGE_UNAVAILABLE", 503); }
  }
  const update = db.prepare(`UPDATE mvp_contests SET photo_asset_key=?,photo_caption=?,body_text=?,sponsor_name=?,gift_description=?,updated_at=MAX(unixepoch('now'),updated_at+1)
    WHERE id=? AND status='finalized' AND winner_player_id=? AND finalized_at=? AND updated_at=?
      AND photo_asset_key IS ? AND photo_caption IS ? AND body_text IS ?
      AND sponsor_name IS ? AND gift_description IS ? AND EXISTS (SELECT 1 FROM league_phases p
        JOIN league_competitions c ON c.id=p.competition_id WHERE p.id=mvp_contests.phase_id AND c.organization_id=?)`)
    .bind(key, text.photoCaption, text.bodyText, text.sponsorName, text.giftDescription,
      contestId, existing.winner_player_id, existing.finalized_at, existing.updated_at,
      existing.photo_asset_key, existing.photo_caption, existing.body_text,
      existing.sponsor_name, existing.gift_description, organizationId);
  const audit = db.prepare(`INSERT INTO league_audit_log (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    SELECT ?,?,'mvp_presentation_updated','mvp_contest',?,?,datetime('now') WHERE changes()=1`)
    .bind(`mvp_audit_${crypto.randomUUID()}`, actor!.email, contestId,
      JSON.stringify({ photoChanged: key !== existing.photo_asset_key }));
  try {
    const results = await db.batch([update, audit]);
    const updated = results[0] as { meta?: { changes?: number } } | undefined;
    if (Number(updated?.meta?.changes) !== 1) throw new MvpPublicationError("PRESENTATION_CONFLICT", 409);
  } catch (error) {
    if (error instanceof MvpPublicationError) throw error;
    if (error instanceof Error && /constraint failed/i.test(error.message)) throw new MvpPublicationError("CONTEST_CONFLICT", 409);
    throw error;
  }
  return { contestId, photoUrl: mvpPhotoUrl(contestId, key), photoCaption: text.photoCaption,
    bodyText: text.bodyText, sponsorName: text.sponsorName, giftDescription: text.giftDescription };
}

export async function readPublicMvpPhotoWithDb(db: D1DatabaseBinding, contestId: string, filename: string) {
  if (!KEY_ID.test(contestId) || !/^[a-f0-9-]{36}\.(jpg|png|webp|avif)$/.test(filename)) return null;
  const row = await db.prepare(`SELECT m.photo_asset_key,p.id AS phase_id,p.competition_id
    FROM mvp_contests m JOIN league_phases p ON p.id=m.phase_id
    WHERE m.id=? AND m.status='finalized' AND m.selection_method='app_poll' AND m.winner_player_id IS NOT NULL
      AND m.finalized_at IS NOT NULL`).bind(contestId)
    .first<{ photo_asset_key: string | null; phase_id: string; competition_id: string }>();
  if (!row?.photo_asset_key?.endsWith(`/${filename}`)) return null;
  try {
    const competition = await readCompetitionDetailWithDb(db, row.competition_id);
    if (!competition.tournamentGroups.some((group) => group.phaseIds.includes(row.phase_id))) return null;
    if (!row.photo_asset_key.startsWith(`mvp/${competition.organizationId}/${contestId}/`)) return null;
  } catch { return null; }
  return row.photo_asset_key;
}
