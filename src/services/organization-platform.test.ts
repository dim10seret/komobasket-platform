import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";
vi.mock("server-only",()=>({}));
const environment=vi.hoisted(()=>({current:{} as Record<string,unknown>}));
vi.mock("@/lib/cloudflare",()=>({getKomoBasketCloudflareEnv:async()=>environment.current}));
import { handleOrganizationPlatform } from "@/lib/organization-platform-http";
import { platformLeagueResources } from "./platform-league-resources";
import { OrganizationUserLoginService } from "./organization-user-login.service";
import { hashOrganizationUserPassword, ORGANIZATION_USER_SESSION_COOKIE_NAME } from "./organization-user-auth-core";
import { createUserPlatformApi } from "@/components/admin/platform/shared/platform-context";

type LocalDatabase={exec(sql:string):void;prepare(sql:string):{get(...args:unknown[]):unknown;all(...args:unknown[]):unknown[];run(...args:unknown[]):{changes:number|bigint}};close():void};
const {DatabaseSync}=createRequire(import.meta.url)("node:sqlite") as {DatabaseSync:new(path:string)=>LocalDatabase};
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const schema=read("../../cloudflare/league-schema.sql");
const foundation=read("../../cloudflare/migrations/0001_platform_foundation.sql");
const schedules=read("../../cloudflare/migrations/0007_c5_phase_schedules_foundation.sql");
const csrf="c".repeat(43),password="Disposable Phase Four Password";
let hash:string,local:LocalDatabase,db:D1DatabaseBinding,token:string,queries:string[];
function statement(sql:string,values:unknown[]=[]):D1PreparedStatement {
  return {
    bind:(...args)=>statement(sql,args),
    first:async<T,>()=>{queries.push(sql);return (local.prepare(sql).get(...values) as T|undefined)??null;},
    all:async<T,>()=>{queries.push(sql);return {success:true,results:local.prepare(sql).all(...values) as T[]};},
    run:async()=>{queries.push(sql);const result=local.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)}};},
  };
}
beforeAll(async()=>{hash=await hashOrganizationUserPassword(password);});
beforeEach(async()=>{
  local=new DatabaseSync(":memory:");queries=[];
  local.exec(schema);
  for(const ddl of foundation.matchAll(/CREATE TABLE IF NOT EXISTS [a-z_]+\s*\([\s\S]*?\);/g))local.exec(ddl[0]);
  local.exec(schedules);
  for(const column of ["created_at","updated_at"]) {
    const columns=local.prepare("PRAGMA table_info(league_phases)").all() as {name:string}[];
    if(!columns.some(item=>item.name===column))local.exec(`ALTER TABLE league_phases ADD COLUMN ${column} TEXT`);
  }
  local.exec(`
    INSERT INTO league_organizations(id,slug,name,logo_url) VALUES ('org-a','org-a','Organization A','/test-logo.svg'),('org-b','org-b','Foreign Organization',NULL);
    INSERT INTO league_app_users(id,email,normalized_email) VALUES ('user-a','user@example.test','user@example.test');
    INSERT INTO league_organization_memberships(id,organization_id,user_id,role) VALUES ('member-a','org-a','user-a','admin');
    INSERT INTO league_seasons(id,name,slug,status) VALUES ('season-a','2026-27','2026-27','active');
    INSERT INTO league_competitions(id,organization_id,season_id,name,slug,status) VALUES ('comp-a','org-a','season-a','Competition A','comp-a','active'),('comp-b','org-b','season-a','Foreign Competition','comp-b','active');
    INSERT INTO league_competition_formats(competition_id,expected_team_count) VALUES ('comp-a',4),('comp-b',4);
    INSERT INTO league_teams(id,organization_id,name,slug,logo_url) VALUES ('team-a','org-a','Team A','team-a','/test-logo.svg'),('team-a2','org-a','Team Without Logo','team-a2',NULL),('team-b','org-b','Foreign Team','team-b',NULL);
    INSERT INTO league_season_teams(id,season_id,team_id,display_name) VALUES ('st-a','season-a','team-a','Team A'),('st-a2','season-a','team-a2','Team Without Logo');
    INSERT INTO league_competition_teams(id,competition_id,season_team_id) VALUES ('ct-a','comp-a','st-a'),('ct-a2','comp-a','st-a2');
    INSERT INTO league_players(id,organization_id,slug,display_name,normalized_name,first_name,last_name) VALUES ('player-a','org-a','player-a','Local Player','local player','Local','Player'),('player-b','org-b','player-b','Foreign Player','foreign player','Foreign','Player');
    INSERT INTO league_roster_memberships(id,season_id,competition_id,team_id,player_id) VALUES ('roster-a','season-a','comp-a','team-a','player-a');
    INSERT INTO league_phases(id,competition_id,name,slug,format,phase_type) VALUES ('phase-a','comp-a','Phase A','phase-a','standings','regular'),('phase-b','comp-b','Foreign Legacy Phase','phase-b','knockout','playoffs');
    INSERT INTO league_games(id,competition_id,phase_id,home_team_id,away_team_id,scheduled_date,scheduled_time) VALUES ('game-a','comp-a','phase-a','team-a','team-a2','2026-09-30','18:00');
    INSERT INTO league_teams(id,organization_id,name,slug) VALUES ('team-b2','org-b','Foreign Opponent','team-b2');
    INSERT INTO league_season_teams(id,season_id,team_id,display_name) VALUES ('st-b','season-a','team-b','Foreign Team'),('st-b2','season-a','team-b2','Foreign Opponent');
    INSERT INTO league_competition_teams(id,competition_id,season_team_id) VALUES ('ct-b','comp-b','st-b'),('ct-b2','comp-b','st-b2');
    INSERT INTO league_roster_memberships(id,season_id,competition_id,team_id,player_id) VALUES ('roster-b','season-a','comp-b','team-b','player-b');
    INSERT INTO league_games(id,competition_id,phase_id,home_team_id,away_team_id) VALUES ('game-b','comp-b','phase-b','team-b','team-b2');
  `);
  local.prepare("INSERT INTO league_user_credentials VALUES ('user-a',?,1,?,?)").run(hash,new Date().toISOString(),new Date().toISOString());
  db={prepare:statement,batch:async(items)=>{local.exec("BEGIN");try{const result=[];for(const item of items)result.push(await item.run());local.exec("COMMIT");return result;}catch(error){local.exec("ROLLBACK");throw error;}}};
  environment.current={NEWS_DB:db,USER_LOGIN_RATE_LIMITER:{limit:async()=>({success:true})}};
  token=(await new OrganizationUserLoginService(db,{limit:async()=>({success:true})}).login("user@example.test",password)).session.token;
  queries=[];
});
afterEach(()=>{vi.restoreAllMocks();local.close();});
async function call(path:string,method="GET",body:unknown={},organizationId="org-a",extra:Record<string,string>={}) {
  const url=new URL("https://example.test/api/user/platform/"+path);
  url.searchParams.set("organizationId",organizationId);
  const request=new Request(url,{method,headers:{
    origin:"https://example.test","sec-fetch-site":"same-origin","content-type":"application/json",
    cookie:`__Host-kb_user_csrf=${csrf}; ${ORGANIZATION_USER_SESSION_COOKIE_NAME}=${token}`,
    "x-kb-user-csrf":csrf,...extra,
  },...(method==="GET"?{}:{body:JSON.stringify(body)})});
  return handleOrganizationPlatform(request,url.pathname.replace("/api/user/platform/","").split("/"));
}
describe("Organization Platform selected-scope integration",()=>{
  function foreignRowsHash() {
    const queries = [
      "SELECT * FROM league_competitions WHERE organization_id='org-b' ORDER BY id",
      "SELECT * FROM league_teams WHERE organization_id='org-b' ORDER BY id",
      "SELECT * FROM league_players WHERE organization_id='org-b' ORDER BY id",
      "SELECT * FROM league_phases WHERE competition_id='comp-b' ORDER BY id",
      "SELECT * FROM league_phase_rules WHERE phase_id='phase-b' ORDER BY phase_id",
      "SELECT * FROM league_games WHERE competition_id='comp-b' ORDER BY id",
      "SELECT * FROM league_roster_memberships WHERE competition_id='comp-b' ORDER BY id",
      "SELECT * FROM league_season_teams WHERE team_id IN ('team-b','team-b2') ORDER BY id",
      "SELECT * FROM league_competition_teams WHERE competition_id='comp-b' ORDER BY id",
    ];
    return createHash("sha256").update(JSON.stringify(queries.map(sql=>local.prepare(sql).all()))).digest("hex");
  }
  it.each(["overview","seasons","competitions","teams","players","movements"])("loads only Organization A section %s",async(section)=>{
    const response=await call("league?section="+section);
    expect(response.status).toBe(200);
    const body=await response.text();
    expect(body).toContain('"organizationId":"org-a"');
    expect(body).not.toMatch(/Foreign (Team|Player|Competition|Legacy Phase)/);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("does not load games/phases/reports until a competition workspace is selected",async()=>{
    const first=await call("league?section=competitions");expect(first.status).toBe(200);
    const list=await first.json();expect(list.games).toEqual([]);expect(list.phases).toEqual([]);
    expect(queries.some(sql=>/FROM league_games g|FROM league_phases p/.test(sql))).toBe(false);
    const second=await call("league?section=competitions&competitionId=comp-a");expect(second.status).toBe(200);
    const detail=await second.json();expect(detail.games.map((game:{id:string})=>game.id)).toEqual(["game-a"]);
    expect(detail.phases.map((phase:{id:string})=>phase.id)).toEqual(["phase-a"]);
  });
  it("loads scoped roster and search projections",async()=>{
    const roster=await call("league?view=team-roster&seasonId=season-a&competitionId=comp-a&teamId=team-a");
    expect(roster.status).toBe(200);expect((await roster.json()).data.athletes[0].player_id).toBe("player-a");
    const search=await call("league?view=searchAthletes&query=Player");
    expect(search.status).toBe(200);expect((await search.json()).map((row:{player_id:string})=>row.player_id)).toEqual(["player-a"]);
  });
  it("allows an Organization Admin administrative closure and records one scoped audit decision",async()=>{
    const response=await call("league/games","PATCH",{id:"game-a",competitionId:"comp-a",action:"administrative-result",decisionType:"interruption",homeScore:42,awayScore:40,homeStandingsPointsOverride:0,awayStandingsPointsOverride:"",reason:"Οριστική διακοπή δοκιμής"});
    expect(response.status).toBe(200);
    expect(local.prepare("SELECT organization_id,game_id,decision_type,official_home_score,official_away_score,home_standings_points_override,away_standings_points_override FROM league_game_administrative_results").get()).toEqual({organization_id:"org-a",game_id:"game-a",decision_type:"interruption",official_home_score:42,official_away_score:40,home_standings_points_override:0,away_standings_points_override:null});
    expect(local.prepare("SELECT COUNT(*) AS count FROM league_audit_log WHERE action='administrative_official_result' AND entity_id='game-a'").get()).toEqual({count:1});
    expect(local.prepare("SELECT status,home_score,away_score FROM league_games WHERE id='game-a'").get()).toEqual({status:"scheduled",home_score:null,away_score:null});
  });
  it("rejects Viewer and cross-organization administrative result mutations",async()=>{
    const foreignBefore=foreignRowsHash();
    expect((await call("league/games","PATCH",{id:"game-b",competitionId:"comp-b",action:"administrative-result",decisionType:"interruption",homeScore:1,awayScore:0,reason:"Forbidden"})).status).toBe(403);
    expect(foreignRowsHash()).toBe(foreignBefore);
    local.exec("UPDATE league_organization_memberships SET role='viewer' WHERE id='member-a'");
    expect((await call("league/games","PATCH",{id:"game-a",competitionId:"comp-a",action:"administrative-result",decisionType:"interruption",homeScore:1,awayScore:0,reason:"Forbidden"})).status).toBe(403);
    expect(local.prepare("SELECT COUNT(*) AS count FROM league_game_administrative_results").get()).toEqual({count:0});
  });
  it("creates/edits an owned Team without running global legacy conversion",async()=>{
    const before = foreignRowsHash();
    const response=await call("league/teams","POST",{name:"New Owned Team",city:"Local"});expect(response.status).toBe(201);
    const {id}=await response.json();
    expect(local.prepare("SELECT organization_id FROM league_teams WHERE id=?").get(id)).toEqual({organization_id:"org-a"});
    expect((await call("league/teams","PATCH",{id,name:"Edited Owned Team",city:"Local",active:1})).status).toBe(200);
    expect(local.prepare("SELECT format,phase_type FROM league_phases WHERE id='phase-b'").get()).toEqual({format:"knockout",phase_type:"playoffs"});
    const after = foreignRowsHash();
    expect(after).toBe(before);
    console.info("Foreign Organization rows SHA-256", {before, after, unchanged: before === after});
    expect(local.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("preserves Super Admin global legacy conversion through the unchanged Admin adapter contract",async()=>{
    local.exec("INSERT INTO league_app_users(id,email,normalized_email,status,is_super_admin) VALUES ('super-admin','admin@example.test','admin@example.test','active',1)");
    const operations = platformLeagueResources({userId:"super-admin",email:"admin@example.test",displayName:null,isSuperAdmin:true,isLocal:false});
    const response = await operations.PATCH(new Request("https://example.test/api/admin/league/teams",{
      method:"PATCH",headers:{"content-type":"application/json"},
      body:JSON.stringify({id:"team-a",name:"Admin Updated Team",city:"Local",active:1}),
    }),{params:Promise.resolve({resource:"teams"})});
    expect(response.status).toBe(200);
    expect(local.prepare("SELECT format,phase_type FROM league_phases WHERE id='phase-b'").get()).toEqual({format:"series",phase_type:"play_in"});
  });
  it("creates a canonical Player only in the selected organization",async()=>{
    const response=await call("league","PATCH",{action:"createRegistryPlayer",firstName:"First",lastName:"Last"});expect(response.status).toBe(200);
    const {playerId}=await response.json();
    expect(local.prepare("SELECT organization_id,first_name,last_name FROM league_players WHERE id=?").get(playerId)).toEqual({organization_id:"org-a",first_name:"First",last_name:"Last"});
  });
  it.each([
    ["league/teams",{id:"team-b",name:"Forbidden"}],
    ["league",{action:"updateAthleteCanonical",playerId:"player-b",firstName:"Forbidden",lastName:"Name"}],
    ["league/competitions",{id:"comp-b",name:"Forbidden"}],
    ["league/phases",{id:"phase-b",name:"Forbidden"}],
    ["league/games",{id:"game-b",status:"cancelled"}],
    ["league",{action:"updateAthleteShirt",rosterId:"roster-b",shirtNumber:99}],
    ["league",{action:"addExistingAthlete",playerId:"player-b",competitionId:"comp-a",teamId:"team-a",seasonId:"season-a"}],
  ])("denies forged foreign resource in %s",async(path,body)=>{
    const before = foreignRowsHash();
    expect((await call(path,"PATCH",body)).status).toBe(403);
    expect(foreignRowsHash()).toBe(before);
  });
  it("does not treat a second active membership as authority for the selected scope",async()=>{
    local.exec("INSERT INTO league_organization_memberships(id,organization_id,user_id,role) VALUES ('member-b','org-b','user-a','admin')");
    expect((await call("league/teams","PATCH",{id:"team-b",name:"Forbidden"})).status).toBe(403);
    expect((await call("league?section=teams","GET",{},"org-b")).status).toBe(200);
  });
  it("denies body scope forgery, cross-org copy and CSV team-selection bypass",async()=>{
    expect((await call("league/teams","POST",{organizationId:"org-b",name:"Forbidden"})).status).toBe(403);
    expect((await call("league/competitions","POST",{name:"Copy",seasonId:"season-a",sourceCompetitionId:"comp-b",copyPhases:true})).status).toBe(403);
    expect((await call("league/participations","POST",{seasonId:"season-a",competitionId:"comp-a",teamIds:"team-b"})).status).toBe(400);
  });
  it.each(["seasons","users","organizations","supporters"])("denies global resource %s",async(resource)=>{
    expect((await call("league/"+resource,"POST",{name:"Forbidden"})).status).toBe(403);
  });
  it("denies scorer-account management but allows scoped KomoControl/public settings",async()=>{
    expect((await call("komocontrol/scorers")).status).toBe(403);
    expect((await call("komocontrol/scorers","POST",{username:"Forbidden"})).status).toBe(403);
    expect((await call("komocontrol/settings")).status).toBe(200);
    expect((await call("organization-public-settings")).status).toBe(200);
    expect((await call("organization-public-settings","PATCH",{publicHeaderLinkUrl:"https://example.test/club"})).status).toBe(200);
  });
  it.each(["POST","PATCH","DELETE"])("denies Viewer %s before all mutations",async(method)=>{
    local.exec("UPDATE league_organization_memberships SET role='viewer'");
    expect((await call("league/teams",method,{id:"team-a",name:"Forbidden"})).status).toBe(403);
    expect((await call("league?section=teams")).status).toBe(200);
    expect((await call("komocontrol/settings")).status).toBe(200);
    expect(local.prepare("SELECT name FROM league_teams WHERE id='team-a'").get()).toEqual({name:"Team A"});
  });
  it.each([
    "UPDATE league_app_users SET status='disabled'",
    "UPDATE league_organization_memberships SET status='revoked'",
    "UPDATE league_organizations SET status='suspended' WHERE id='org-a'",
    "UPDATE league_user_credentials SET credential_version=2",
    "UPDATE league_user_sessions SET revoked_at='2026-01-01T00:00:00Z'",
    "UPDATE league_app_users SET is_super_admin=1",
  ])("rechecks authoritative session/membership state: %s",async(sql)=>{
    local.exec(sql);expect([401,403]).toContain((await call("league?section=teams")).status);
  });
  it.each([{origin:"https://evil.test"},{"x-kb-user-csrf":""},{cookie:""},{ "sec-fetch-site":"same-site"}])("denies forged mutation proof %j",async(headers)=>{
    expect((await call("league/teams","POST",{name:"Forbidden"},"org-a",headers)).status).toBe(403);
  });
  it("has no anonymous or spoofed-email access",async()=>{
    expect((await call("league?section=teams","GET",{},"org-a",{cookie:"","cf-access-authenticated-user-email":"user@example.test"})).status).toBe(401);
  });
});
describe("Shared UI API boundary",()=>{
  it("maps cover upload and removal to the selected Organization with CSRF",async()=>{
    const request=vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({siteCoverUrl:null}));
    const api=createUserPlatformApi("org-a","admin",csrf);
    const body=new FormData();body.set("organizationId","org-b");body.set("file",new File(["test"],"cover.png",{type:"image/png"}));
    await api.request("/api/admin/organization-site-cover",{method:"POST",body});
    await api.request("/api/admin/organization-site-cover",{method:"DELETE",body:JSON.stringify({organizationId:"org-b"})});
    expect(request.mock.calls[0][0]).toBe("/api/user/platform/organization-site-cover?organizationId=org-a");
    expect((request.mock.calls[0][1]?.body as FormData).get("organizationId")).toBe("org-a");
    expect(new Headers(request.mock.calls[0][1]?.headers).get("x-kb-user-csrf")).toBe(csrf);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).organizationId).toBe("org-a");
  });
  it("maps every shared Admin business path to /api/user, binds scope and attaches CSRF",async()=>{
    const request=vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({ok:true}));
    const api=createUserPlatformApi("org-a","admin",csrf);
    await api.request("/api/admin/league/teams",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Team"})});
    const [url,options]=request.mock.calls[0];
    expect(url).toBe("/api/user/platform/league/teams?organizationId=org-a");
    expect(new Headers(options?.headers).get("x-kb-user-csrf")).toBe(csrf);
    expect(JSON.parse(String(options?.body)).organizationId).toBe("org-a");
    expect(api.url("/api/admin/match-reports/game-a/game-sheet")).toContain("/api/user/platform/match-reports/game-a/game-sheet");
  });
  it("permits Viewer read-search through GET and never sends a Viewer mutation",async()=>{
    const request=vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json([]));
    const api=createUserPlatformApi("org-a","viewer",csrf);
    await api.request("/api/admin/league",{method:"PATCH",body:JSON.stringify({action:"searchAthletes",query:"Player"})});
    expect(request.mock.calls[0][1]?.method).toBe("GET");
    expect(String(request.mock.calls[0][0])).toContain("view=searchAthletes");
    expect((await api.request("/api/admin/league/teams",{method:"DELETE",body:'{"id":"team-a"}'})).status).toBe(403);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("maps matchday MVP reads and Organization Admin writes through the same scoped adapter",async()=>{
    const request=vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({eligible:true,candidates:[]}));
    const api=createUserPlatformApi("org-a","admin",csrf);
    await api.request("/api/admin/matchday-mvp?competitionId=competition-a&phaseId=phase-a&roundNumber=1");
    await api.request("/api/admin/matchday-mvp",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({competitionId:"competition-a",phaseId:"phase-a",roundNumber:1,gameId:"game-a",playerId:"player-a"})});
    expect(String(request.mock.calls[0][0])).toContain("/api/user/platform/matchday-mvp");
    expect(String(request.mock.calls[0][0])).toContain("organizationId=org-a");
    expect(new Headers(request.mock.calls[1][1]?.headers).get("x-kb-user-csrf")).toBe(csrf);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).organizationId).toBe("org-a");
  });
  it("keeps Viewer matchday MVP access read-only",async()=>{
    const request=vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json({eligible:true,candidates:[]}));
    const api=createUserPlatformApi("org-a","viewer",csrf);
    expect((await api.request("/api/admin/matchday-mvp",{method:"PATCH",body:JSON.stringify({competitionId:"competition-a"})})).status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("Organization-user Site cover endpoint",()=>{
  async function coverUpload(scope="org-a",bodyOrg="org-a",extra:Record<string,string>={}) {
    const body=new FormData();body.set("organizationId",bodyOrg);body.set("file",new File(["disposable image"],"cover.png",{type:"image/png"}));
    return handleOrganizationPlatform(new Request("https://example.test/api/user/platform/organization-site-cover?organizationId="+scope,{
      method:"POST",body,headers:{origin:"https://example.test","sec-fetch-site":"same-origin",cookie:`__Host-kb_user_csrf=${csrf}; ${ORGANIZATION_USER_SESSION_COOKIE_NAME}=${token}`,"x-kb-user-csrf":csrf,...extra},
    }),["organization-site-cover"]);
  }
  it("uploads, reads and removes through the authenticated organization-user route",async()=>{
    const put=vi.fn().mockResolvedValue({});environment.current.NEWS_IMAGES={put};
    const response=await coverUpload();expect(response.status).toBe(200);
    const {siteCoverUrl}=await response.json();expect(siteCoverUrl).toContain("/org-a/site-cover/");
    expect((await (await call("organization-public-settings")).json()).organization.site_cover_url).toBe(siteCoverUrl);
    expect((await call("organization-site-cover","DELETE")).status).toBe(200);
    expect(local.prepare("SELECT site_cover_url FROM league_organizations WHERE id='org-a'").get()).toEqual({site_cover_url:null});
    expect(put).toHaveBeenCalledTimes(1);
  });
  it("rejects foreign scope/body, missing CSRF and Viewer upload/remove before storage",async()=>{
    const put=vi.fn().mockResolvedValue({});environment.current.NEWS_IMAGES={put};
    expect((await coverUpload("org-b","org-b")).status).toBe(403);
    expect((await coverUpload("org-a","org-b")).status).toBe(403);
    expect((await coverUpload("org-a","org-a",{"x-kb-user-csrf":""})).status).toBe(403);
    local.exec("UPDATE league_organization_memberships SET role='viewer'");
    expect((await coverUpload()).status).toBe(403);
    expect((await call("organization-site-cover","DELETE")).status).toBe(403);
    expect(put).not.toHaveBeenCalled();
  });
});
