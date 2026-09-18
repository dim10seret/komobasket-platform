import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";
vi.mock("server-only",()=>({}));
const environment=vi.hoisted(()=>({current:{} as Record<string,unknown>}));
vi.mock("@/lib/cloudflare",()=>({getKomoBasketCloudflareEnv:async()=>environment.current}));
import { handleOrganizationPlatform } from "@/lib/organization-platform-http";
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

describe("Organization Platform roster isolation", () => {
  it("edits only the canonical logo through participation management", async () => {
    const { updateLeagueEntity } = await import("./league-admin.service");
    local.exec("UPDATE league_season_teams SET logo_url='/old-season.png' WHERE id='st-a'");
    await updateLeagueEntity("participations", { id: "ct-a", logoUrl: "/new-team.png" }, "admin@example.test", "org-a");
    expect(local.prepare("SELECT logo_url FROM league_teams WHERE id='team-a'").get()).toEqual({ logo_url: "/new-team.png" });
    expect(local.prepare("SELECT logo_url FROM league_season_teams WHERE id='st-a'").get()).toEqual({ logo_url: "/old-season.png" });
    expect(local.prepare("SELECT logo_url FROM league_teams WHERE id='team-b'").get()).toEqual({ logo_url: null });
  });
  it("preserves the canonical logo during an unrelated participation edit", async () => {
    const { updateLeagueEntity } = await import("./league-admin.service");
    local.exec("UPDATE league_season_teams SET logo_url='/old-season.png' WHERE id='st-a'");
    await updateLeagueEntity("participations", { id: "ct-a", displayName: "Season name" }, "admin@example.test", "org-a");
    expect(local.prepare("SELECT logo_url FROM league_teams WHERE id='team-a'").get()).toEqual({ logo_url: "/test-logo.svg" });
    expect(local.prepare("SELECT display_name,logo_url FROM league_season_teams WHERE id='st-a'").get()).toEqual({ display_name: "Season name", logo_url: "/old-season.png" });
  });
  it.each([null, "", "   "])("clears the canonical logo without copying the seasonal logo for %s", async (logoUrl) => {
    const { updateLeagueEntity } = await import("./league-admin.service");
    local.exec("UPDATE league_season_teams SET logo_url='/old-season.png' WHERE id='st-a'");
    await updateLeagueEntity("participations", { id: "ct-a", logoUrl }, "admin@example.test", "org-a");
    expect(local.prepare("SELECT logo_url FROM league_teams WHERE id='team-a'").get()).toEqual({ logo_url: null });
    expect(local.prepare("SELECT logo_url FROM league_season_teams WHERE id='st-a'").get()).toEqual({ logo_url: "/old-season.png" });
  });
  it("loads the owned roster and only owned player search results", async () => {
    const roster = await call("league?view=team-roster&seasonId=season-a&competitionId=comp-a&teamId=team-a");
    expect(roster.status).toBe(200);
    const body = await roster.json();
    expect(body.data.athletes.map((row: {player_id: string}) => row.player_id)).toEqual(["player-a"]);
    expect(body.data.staff).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("player-b");
    const search = await call("league?view=searchAthletes&query=Player");
    expect(search.status).toBe(200);
    expect((await search.json()).map((row: {player_id: string}) => row.player_id)).toEqual(["player-a"]);
  });
  it.each([
    ["comp-b", "team-a"],
    ["comp-a", "team-b"],
    ["comp-b", "team-b"],
  ])("denies foreign roster selection %s / %s within the selected Organization", async (competition, team) => {
    local.exec("INSERT INTO league_organization_memberships(id,organization_id,user_id,role) VALUES ('member-b','org-b','user-a','admin')");
    const response = await call(`league?view=team-roster&seasonId=season-a&competitionId=${competition}&teamId=${team}`);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toMatch(/player-b|Foreign Player/);
  });
  it("permits Viewer roster reads without an Admin API dependency", async () => {
    local.exec("UPDATE league_organization_memberships SET role='viewer'");
    const network = vi.spyOn(globalThis, "fetch");
    const response = await call("league?view=team-roster&seasonId=season-a&competitionId=comp-a&teamId=team-a");
    expect(response.status).toBe(200);
    expect(network).not.toHaveBeenCalled();
  });
});
