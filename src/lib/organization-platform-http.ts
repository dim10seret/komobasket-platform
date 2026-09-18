import "server-only";
import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { requireUserMutationOrigin, USER_CSRF_COOKIE, userCookie } from "@/lib/organization-user-http";
import { OrganizationUserAuthError, ORGANIZATION_USER_SESSION_COOKIE_NAME } from "@/services/organization-user-auth-core";
import { organizationUserLoginService, UserLoginError } from "@/services/organization-user-login.service";
import { platformOperationScope } from "@/lib/platform-operation-scope";
import { platformAuthorizationErrorResponse } from "@/lib/platform-authorization";
import { platformLeagueActions } from "@/services/platform-league-actions";
import { platformLeagueResources } from "@/services/platform-league-resources";
import { getLeagueAdminSnapshot, getTeamRosterManagementView, listCompetitionLatestMovements, searchAthletesForRosterFoundation, searchStaffForRosterFoundation } from "@/services/league-admin.service";
import { platformTeamLogo } from "@/services/team-logo-route-operation";
import { platformPublicHeaderLogo } from "@/services/organization-public-header-logo-operation";
import { updateManagedOrganizationPublicPresentation } from "@/services/platform-management.service";
import * as komo from "@/services/komocontrol-admin.service";
import { readPlatformMatchReport } from "@/services/platform-match-report.service";
import { readPlatformGameSheet, renderPlatformGameSheetHtml } from "@/services/platform-game-sheet.service";
import { generateStatisticsPdf, statisticsPdfFilename } from "@/services/platform-statistics-pdf.service";

const sections = new Set(["overview", "seasons", "competitions", "teams", "players", "movements"]);
const resources = new Set(["competitions", "teams", "participations", "competition-venues", "players", "rosters", "phases", "phase-schedules", "games"]);
const actions = new Set(["departure", "removeAthleteFromRoster", "createAthleteWithRoster", "createRegistryPlayer", "addExistingAthlete", "transferAthlete", "addAthleteMovement", "bulkAddExistingAthletes", "updateAthleteCanonical", "updateAthleteShirt", "createStaffWithRoster", "addExistingStaff", "updateStaffCanonical", "updateStaffMembership", "removeStaffFromRoster", "copyPreviousRoster", "bulkScheduleGames", "finalizePhase", "departPlayerLegacy"]);
const deny = () => Response.json({ error: "Δεν επιτρέπεται αυτή η ενέργεια." }, { status: 403 });

function mutationOrigin(request: Request, multipart: boolean) {
  if (!multipart) return requireUserMutationOrigin(request);
  const origin = new URL(request.url).origin;
  const csrf = userCookie(request, USER_CSRF_COOKIE);
  if (request.headers.get("origin") !== origin ||
      (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin") ||
      !csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf) || request.headers.get("x-kb-user-csrf") !== csrf) {
    throw new UserLoginError("FORBIDDEN", 403);
  }
}
async function inputFrom(request: Request, organizationId: string) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 131072) throw new Error("REQUEST_TOO_LARGE");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_INPUT");
  const input = value as Record<string, unknown>;
  for (const key of ["organizationId", "organization_id"]) {
    if (input[key] !== undefined && String(input[key]) !== organizationId) throw new UserLoginError("FORBIDDEN", 403);
  }
  return { ...input, organizationId };
}

async function readLeague(url: URL, actor: CanonicalAppUser, organizationId: string, role: "admin" | "viewer", logoUrl: string | null) {
  const scoped = platformOperationScope(organizationId);
  const access = await scoped.requireOrganizationAccess(actor, organizationId, "read");
  const view = url.searchParams.get("view");
  const competitionId = url.searchParams.get("competitionId")?.trim() || "";
  if (competitionId) await scoped.requireCompetitionAccess(actor, competitionId, "read");
  if (view === "searchAthletes" || view === "searchStaff") {
    const input = { query: (url.searchParams.get("query") || "").slice(0,200), limit: 25 };
    return Response.json(await (view === "searchAthletes" ? searchAthletesForRosterFoundation(input, organizationId) : searchStaffForRosterFoundation(input, organizationId)));
  }
  if (view === "team-roster") {
    const teamId = url.searchParams.get("teamId") || "";
    await scoped.requireTeamAccess(actor, teamId, "read");
    return Response.json({ view, data: await getTeamRosterManagementView(url.searchParams.get("seasonId") || "", competitionId, teamId, organizationId) });
  }
  if (view === "competition-latest-movements") return Response.json({view, data: await listCompetitionLatestMovements({organizationId, seasonId: url.searchParams.get("seasonId") || "", competitionId})});
  const section = url.searchParams.get("section") || "overview";
  if (!sections.has(section) || view) return deny();
  return Response.json({
    ...await getLeagueAdminSnapshot(organizationId, {section, competitionId}),
    organizationContext: {organizationId, slug:access.organizationSlug, name:access.organizationName, logoUrl, role},
  });
}
async function publicSettings(organizationId: string, role: "admin" | "viewer") {
  const db = (await getKomoBasketCloudflareEnv())?.NEWS_DB;
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const organization = await db.prepare(`SELECT id,name,slug,logo_url,public_header_logo_url,public_header_link_url,publication_status
    FROM league_organizations WHERE id=? AND status='active'`).bind(organizationId).first();
  return Response.json({organization,role});
}
async function komoOperation(resource: string, request: Request, url: URL, actor: CanonicalAppUser, organizationId: string, input: Record<string,unknown>) {
  if (!["settings", "games", "game-settings", "referees", "table-officials"].includes(resource)) return deny();
  if (request.method === "GET") {
    if (resource === "settings") return Response.json(await komo.listKomoControlSettings(organizationId, url.searchParams.get("competitionId") || undefined));
    if (resource === "games") return Response.json({games:await komo.listKomoControlGames(organizationId, url.searchParams.get("fromDate") || "", url.searchParams.get("toDate") || "", url.searchParams.get("competitionId") || undefined)});
    if (resource === "game-settings") return Response.json(await komo.buildGamePackagePreview(organizationId, url.searchParams.get("gameId") || ""));
    if (resource === "referees" || resource === "table-officials") return Response.json({entries:await komo.listRegistry(organizationId,resource)});
  }
  if (request.method === "POST" || request.method === "PATCH") {
    if (resource === "settings") return Response.json({settings:await komo.saveKomoControlSettings(organizationId,input)});
    if (resource === "game-settings") return Response.json(await komo.saveGameOverride(organizationId,input));
    if (resource === "games" && request.method === "POST") return Response.json(Array.isArray(input.gameIds) ? await komo.publishGamePackages(organizationId,input.gameIds,actor.userId) : await komo.publishGamePackage(organizationId,String(input.gameId || ""),actor.userId));
    if (resource === "referees" || resource === "table-officials") {
      if (request.method === "POST") return Response.json({entry:await komo.createRegistryEntry(organizationId,resource,input)},{status:201});
      await komo.updateRegistryEntry(organizationId,resource,input);return Response.json({ok:true});
    }
  }
  return deny();
}
async function report(gameId: string, format: string | undefined, actor: CanonicalAppUser, organizationId: string) {
  await platformOperationScope(organizationId).requireGameAccess(actor,gameId,"read");
  if (format === "game-sheet") {
    const result = await readPlatformGameSheet(gameId,organizationId);
    if (result.kind === "unavailable") return Response.json({error:result.reason},{status:409});
    const nonce=crypto.randomUUID().replaceAll("-","");
    return new Response(renderPlatformGameSheetHtml(result.sheet,nonce),{headers:{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`}});
  }
  if (format && format !== "statistics") return deny();
  const result=await readPlatformMatchReport(gameId,organizationId);
  if(result.kind === "unavailable") return Response.json({error:"MATCH_REPORT_UNAVAILABLE",availability:result.availability},{status:409});
  if (!format) return Response.json({data:result.report});
  const pdf=await generateStatisticsPdf(result.report);
  const body=new ArrayBuffer(pdf.byteLength);new Uint8Array(body).set(pdf);
  return new Response(body,{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="komobasket-statistics.pdf"; filename*=UTF-8''${encodeURIComponent(statisticsPdfFilename(result.report))}`}});
}
async function dispatch(request: Request, path: string[]) {
  const url=new URL(request.url);
  const organizationId=url.searchParams.get("organizationId")?.trim() || "";
  if (!organizationId || !path.length || path.length>3) return deny();
  const mutation=request.method!=="GET";
  const multipart=(request.headers.get("content-type") || "").startsWith("multipart/form-data;");
  if (mutation) mutationOrigin(request,multipart);
  else if (request.headers.get("sec-fetch-site")==="cross-site") return deny();
  const session=userCookie(request,ORGANIZATION_USER_SESSION_COOKIE_NAME) || "";
  const {identity,membership}=await (await organizationUserLoginService()).requireOrganization(session,organizationId,mutation?"manage":"read");
  const actor:CanonicalAppUser={userId:identity.user.id,email:identity.user.email,displayName:identity.user.displayName,isSuperAdmin:false,isLocal:false};
  const [area,resource,format]=path;
  if (multipart) {
    if(request.method!=="POST" || path.length!==1 || !["team-logo-route","organization-public-header-logo"].includes(area))return deny();
    const bytes=await request.arrayBuffer();if(bytes.byteLength>6*1024*1024)return Response.json({error:"REQUEST_TOO_LARGE"},{status:413});
    const copy=new Request(request.url,{method:"POST",headers:request.headers,body:bytes});
    const form=await copy.formData();
    if(form.has("organizationId") && String(form.get("organizationId"))!==organizationId)return deny();
    form.set("organizationId",organizationId);
    const upload=new Request(request.url,{method:"POST",body:form});
    return area==="team-logo-route" ? platformTeamLogo(actor,organizationId)(upload) : platformPublicHeaderLogo(actor,organizationId)(upload);
  }
  const input: Record<string, unknown>=mutation ? await inputFrom(request,organizationId) : {};
  if(area==="league") {
    if(path.length===1 && !mutation)return readLeague(url,actor,organizationId,membership.role,membership.logoUrl);
    if(path.length>2)return deny();
    const forwarded=new Request(request.url,{method:request.method,headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
    if(path.length===1 && request.method==="PATCH" && actions.has(String(input.action)))return platformLeagueActions(actor,organizationId).PATCH(forwarded);
    if(!resource || !resources.has(resource) || !["POST","PATCH","DELETE"].includes(request.method))return deny();
    const operations=platformLeagueResources(actor,organizationId);
    return operations[request.method as "POST"|"PATCH"|"DELETE"](forwarded,{params:Promise.resolve({resource})});
  }
  if(area==="komocontrol" && path.length===2)return komoOperation(resource,request,url,actor,organizationId,input);
  if(area==="organization-public-settings" && path.length===1) {
    if(!mutation)return publicSettings(organizationId,membership.role);
    if(request.method==="PATCH")return Response.json({organization:await updateManagedOrganizationPublicPresentation(organizationId,input,actor.email)});
  }
  if(area==="match-reports" && !mutation && resource)return report(resource,format,actor,organizationId);
  return deny();
}
export async function handleOrganizationPlatform(request: Request, path: string[]) {
  let response:Response;
  try {response=await dispatch(request,path);}
  catch(error) {
    if(error instanceof OrganizationUserAuthError)response=Response.json({error:"Απαιτείται σύνδεση."},{status:401});
    else if(error instanceof UserLoginError)response=Response.json({error:error.message},{status:error.status});
    else response=platformAuthorizationErrorResponse(error) ?? komo.komoControlAdminErrorResponse(error) ?? Response.json({error:error instanceof Error && error.message==="REQUEST_TOO_LARGE" ? "Το αίτημα είναι πολύ μεγάλο." : "Η ενέργεια δεν ολοκληρώθηκε."},{status:400});
  }
  response.headers.set("Cache-Control","private, no-store");
  response.headers.set("Vary","Cookie");
  response.headers.set("X-Content-Type-Options","nosniff");
  return response;
}
