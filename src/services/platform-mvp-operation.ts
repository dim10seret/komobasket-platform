import "server-only";

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse } from "@/lib/platform-authorization";
import { MvpContestError, type StartMvpContestInput } from "@/services/mvp-contest.service";
import { MvpFinalizationError } from "@/services/mvp-finalization.service";
import { PlatformMvpError, addPlatformMvpCandidateWithDb, previewPlatformMvpWithDb, readPlatformMvpWithDb,
  resolvePlatformMvpWithDb, setPlatformPhaseMvpWithDb, startPlatformMvpWithDb, updatePlatformMvpContestWithDb } from "@/services/platform-mvp-management.service";
import { MvpPublicationError, updateMvpPresentationWithDb } from "@/services/mvp-publication.service";
import type { D1DatabaseBinding, R2BucketBinding } from "@/types/cloudflare";

function scope(input: Record<string, unknown>): StartMvpContestInput {
  const phaseId = typeof input.phaseId === "string" ? input.phaseId.trim() : "";
  if (input.scopeType === "round") return { phaseId, scopeType: "round", roundNumber: Number(input.roundNumber),
    candidatePlayerIds: Array.isArray(input.candidatePlayerIds) ? input.candidatePlayerIds : [],
    durationHours: input.durationHours === undefined ? undefined : Number(input.durationHours),
    closesAt: typeof input.closesAt === "string" ? input.closesAt : undefined,
    resultsVisibility: input.resultsVisibility as "live" | "after_close" | undefined };
  if (input.scopeType === "series") return { phaseId, scopeType: "series", matchupId: String(input.matchupId ?? "").trim(),
    candidatePlayerIds: Array.isArray(input.candidatePlayerIds) ? input.candidatePlayerIds : [],
    durationHours: input.durationHours === undefined ? undefined : Number(input.durationHours),
    closesAt: typeof input.closesAt === "string" ? input.closesAt : undefined,
    resultsVisibility: input.resultsVisibility as "live" | "after_close" | undefined };
  throw new PlatformMvpError("INVALID_INPUT", 400);
}

export async function platformMvpOperation(db: D1DatabaseBinding, actor: CanonicalAppUser | null, organizationId: string,
  method: "GET" | "POST" | "PATCH", input: Record<string, unknown>) {
  if (method === "GET") {
    if (input.action === "preview") return Response.json(await previewPlatformMvpWithDb(db, actor, organizationId, scope(input)));
    if (input.action !== undefined) throw new PlatformMvpError("INVALID_INPUT", 400);
    return Response.json(await readPlatformMvpWithDb(db, actor, organizationId));
  }
  let result: unknown;
  if (method === "POST" && input.action === "start") result = await startPlatformMvpWithDb(db, actor, organizationId, scope(input));
  else if (method === "PATCH" && input.action === "phase") result = await setPlatformPhaseMvpWithDb(db, actor, organizationId,
    String(input.phaseId ?? ""), input.enabled as boolean);
  else if (method === "PATCH" && input.action === "candidate") result = await addPlatformMvpCandidateWithDb(db, actor, organizationId,
    String(input.contestId ?? ""), String(input.playerId ?? ""));
  else if (method === "PATCH" && input.action === "settings") result = await updatePlatformMvpContestWithDb(db, actor, organizationId, {
    contestId: String(input.contestId ?? ""), closesAt: typeof input.closesAt === "string" ? input.closesAt : undefined,
    resultsVisibility: input.resultsVisibility as "live" | "after_close" | undefined,
  });
  else if (method === "PATCH" && input.action === "resolve") result = await resolvePlatformMvpWithDb(db, actor, organizationId, {
    contestId: String(input.contestId ?? ""), candidateId: String(input.candidateId ?? ""), reason: String(input.reason ?? ""),
  });
  else throw new PlatformMvpError("INVALID_INPUT", 400);
  return Response.json(result);
}

export async function platformMvpPresentationOperation(db: D1DatabaseBinding, bucket: R2BucketBinding | undefined,
  actor: CanonicalAppUser | null, organizationId: string, form: FormData) {
  const photo = form.get("photo");
  if (photo !== null && !(photo instanceof File)) throw new MvpPublicationError("INVALID_IMAGE", 400);
  if (form.get("removePhoto") !== null && form.get("removePhoto") !== "true")
    throw new MvpPublicationError("INVALID_INPUT", 400);
  const result = await updateMvpPresentationWithDb(db, bucket, actor, organizationId,
    String(form.get("contestId") ?? ""), {
      presentationRevision: form.get("presentationRevision"),
      photoCaption: form.get("photoCaption"), bodyText: form.get("bodyText"),
      sponsorName: form.get("sponsorName"), giftDescription: form.get("giftDescription"),
      photo: photo as File | null, removePhoto: form.get("removePhoto") === "true",
    });
  return Response.json(result);
}

export function platformMvpErrorResponse(error: unknown): Response | null {
  if (error instanceof PlatformMvpError || error instanceof MvpContestError || error instanceof MvpFinalizationError ||
      error instanceof MvpPublicationError)
    return Response.json({ error: error.code }, { status: error.status });
  return platformAuthorizationErrorResponse(error);
}
