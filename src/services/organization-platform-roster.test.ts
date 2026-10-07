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
function seedOwnedPlayer(id:string) {
  local.prepare("INSERT INTO league_players(id,organization_id,slug,display_name,normalized_name) VALUES (?,'org-a',?,?,?)").run(id,id,id,id);
}
function seedRoster(id:string,playerId:string,teamId:string,shirtNumber:string|null,status="active",seasonId="season-a",competitionId="comp-a") {
  local.prepare("INSERT INTO league_roster_memberships(id,season_id,competition_id,player_id,team_id,shirt_number,status) VALUES (?,?,?,?,?,?,?)")
    .run(id,seasonId,competitionId,playerId,teamId,shirtNumber,status);
}
function makeBaseRosterInactive(shirtNumber:string|null) {
  local.prepare("UPDATE league_roster_memberships SET status='departed',shirt_number=? WHERE id='roster-a'").run(shirtNumber);
}
async function reactivateBaseRoster() {
  const { addAthleteToCompetitionRosterWithMovement } = await import("./league-admin.service");
  return addAthleteToCompetitionRosterWithMovement({playerId:"player-a",seasonId:"season-a",competitionId:"comp-a",teamId:"team-a"});
}
async function transferToHistoricalRoster(shirtNumber:string|null=null) {
  const { transferAthleteBetweenTeams } = await import("./league-admin.service");
  return transferAthleteBetweenTeams({playerId:"player-a",seasonId:"season-a",competitionId:"comp-a",fromTeamId:"team-a",toTeamId:"team-a2",shirtNumber});
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
  it("preserves textual 0 and 00 through Platform edits and rejects exact duplicates", async () => {
    const zero = await call("league", "PATCH", { action: "updateAthleteShirt", rosterId: "roster-a", shirtNumber: "0" });
    expect(zero.status).toBe(200);
    expect(local.prepare("SELECT shirt_number,typeof(shirt_number) AS storage_type FROM league_roster_memberships WHERE id='roster-a'").get()).toEqual({ shirt_number: "0", storage_type: "text" });
    const doubleZero = await call("league", "PATCH", { action: "updateAthleteShirt", rosterId: "roster-a", shirtNumber: "00" });
    expect(doubleZero.status).toBe(200);
    expect(local.prepare("SELECT shirt_number FROM league_roster_memberships WHERE id='roster-a'").get()).toEqual({ shirt_number: "00" });

    local.exec("INSERT INTO league_players(id,organization_id,slug,display_name,normalized_name) VALUES ('player-c','org-a','player-c','Zero Player','zero player'),('player-d','org-a','player-d','Double Zero Player','double zero player'),('player-e','org-a','player-e','Duplicate Player','duplicate player')");
    const bulk = await call("league", "PATCH", { action: "bulkAddExistingAthletes", seasonId: "season-a", competitionId: "comp-a", teamId: "team-a", items: [{ playerId: "player-c", shirtNumber: "0" }] });
    expect(bulk.status).toBe(200);
    expect(local.prepare("SELECT shirt_number FROM league_roster_memberships WHERE player_id='player-c'").get()).toEqual({ shirt_number: "0" });
    const duplicate = await call("league", "PATCH", { action: "addExistingAthlete", playerId: "player-e", seasonId: "season-a", competitionId: "comp-a", teamId: "team-a", shirtNumber: "00" });
    expect(duplicate.status).toBe(400);
    expect(await duplicate.text()).toContain("χρησιμοποιείται ήδη");
  });
  it.each(["01", "000", "001", "100", "1.0", "-1", "abc", "   "])("rejects invalid textual shirt number %s", async (shirtNumber) => {
    const response = await call("league", "PATCH", { action: "updateAthleteShirt", rosterId: "roster-a", shirtNumber });
    expect(response.status).toBe(400);
  });
});

describe("Roster reactivation effective jersey", () => {
  it("rejects retained #7 when another active player holds #7 in the same roster", async () => {
    makeBaseRosterInactive("7");
    seedOwnedPlayer("player-c");
    seedRoster("roster-c","player-c","team-a","7");
    await expect(reactivateBaseRoster()).rejects.toThrow("χρησιμοποιείται ήδη");
    expect(local.prepare("SELECT status,shirt_number FROM league_roster_memberships WHERE id='roster-a'").get())
      .toEqual({status:"departed",shirt_number:"7"});
  });

  it("reactivates and retains #7 when there is no active conflict", async () => {
    makeBaseRosterInactive("7");
    await reactivateBaseRoster();
    expect(local.prepare("SELECT status,shirt_number FROM league_roster_memberships WHERE id='roster-a'").get())
      .toEqual({status:"active",shirt_number:"7"});
  });

  it("reactivates a membership with no effective jersey", async () => {
    makeBaseRosterInactive(null);
    seedOwnedPlayer("player-c");
    seedRoster("roster-c","player-c","team-a","7");
    await reactivateBaseRoster();
    expect(local.prepare("SELECT status,shirt_number FROM league_roster_memberships WHERE id='roster-a'").get())
      .toEqual({status:"active",shirt_number:null});
  });

  it("rejects transfer reactivation when null input retains a conflicting #7", async () => {
    seedRoster("roster-destination","player-a","team-a2","7","departed");
    seedOwnedPlayer("player-c");
    seedRoster("roster-c","player-c","team-a2","7");
    await expect(transferToHistoricalRoster()).rejects.toThrow("χρησιμοποιείται ήδη");
    expect(local.prepare("SELECT status,shirt_number FROM league_roster_memberships WHERE id='roster-destination'").get())
      .toEqual({status:"departed",shirt_number:"7"});
    expect(local.prepare("SELECT status FROM league_roster_memberships WHERE id='roster-a'").get()).toEqual({status:"active"});
  });

  it("allows transfer reactivation with null input when retained #7 is available", async () => {
    seedRoster("roster-destination","player-a","team-a2","7","departed");
    await transferToHistoricalRoster();
    expect(local.prepare("SELECT status,shirt_number FROM league_roster_memberships WHERE id='roster-destination'").get())
      .toEqual({status:"active",shirt_number:"7"});
    expect(local.prepare("SELECT status FROM league_roster_memberships WHERE id='roster-a'").get()).toEqual({status:"transferred"});
  });

  it.each([
    ["0","0",false],
    ["00","00",false],
    ["0","00",true],
    ["00","0",true],
  ] as const)("preserves textual identity for retained %s against active %s", async (historical,active,allowed) => {
    seedRoster("roster-destination","player-a","team-a2",historical,"departed");
    seedOwnedPlayer("player-c");
    seedRoster("roster-c","player-c","team-a2",active);
    if (allowed) {
      await transferToHistoricalRoster();
      expect(local.prepare("SELECT status,shirt_number FROM league_roster_memberships WHERE id='roster-destination'").get())
        .toEqual({status:"active",shirt_number:historical});
    } else {
      await expect(transferToHistoricalRoster()).rejects.toThrow("χρησιμοποιείται ήδη");
      expect(local.prepare("SELECT status,shirt_number FROM league_roster_memberships WHERE id='roster-destination'").get())
        .toEqual({status:"departed",shirt_number:historical});
    }
  });

  it("checks the supplied transfer jersey rather than a retained historical jersey", async () => {
    seedRoster("roster-destination","player-a","team-a2","7","departed");
    seedOwnedPlayer("player-c");
    seedRoster("roster-c","player-c","team-a2","7");
    await transferToHistoricalRoster("00");
    expect(local.prepare("SELECT status,shirt_number FROM league_roster_memberships WHERE id='roster-destination'").get())
      .toEqual({status:"active",shirt_number:"00"});
  });

  it("allows the same jersey on a different team", async () => {
    makeBaseRosterInactive("7");
    seedOwnedPlayer("player-c");
    seedRoster("roster-c","player-c","team-a2","7");
    await reactivateBaseRoster();
    expect(local.prepare("SELECT status,shirt_number FROM league_roster_memberships WHERE id='roster-a'").get())
      .toEqual({status:"active",shirt_number:"7"});
  });

  it.each(["competition","season"])("allows the same jersey in a different %s", async (scope) => {
    makeBaseRosterInactive("7");
    seedOwnedPlayer("player-c");
    if (scope === "competition") {
      local.exec("INSERT INTO league_competitions(id,organization_id,season_id,name,slug,status) VALUES ('comp-other','org-a','season-a','Other Competition','other','active'); INSERT INTO league_competition_formats(competition_id,expected_team_count) VALUES ('comp-other',4); INSERT INTO league_competition_teams(id,competition_id,season_team_id) VALUES ('ct-other','comp-other','st-a');");
      seedRoster("roster-c","player-c","team-a","7","active","season-a","comp-other");
    } else {
      local.exec("INSERT INTO league_seasons(id,name,slug,status) VALUES ('season-other','2027-28','2027-28','active'); INSERT INTO league_competitions(id,organization_id,season_id,name,slug,status) VALUES ('comp-other','org-a','season-other','Other Competition','other','active'); INSERT INTO league_competition_formats(competition_id,expected_team_count) VALUES ('comp-other',4); INSERT INTO league_season_teams(id,season_id,team_id,display_name) VALUES ('st-other','season-other','team-a','Team A'); INSERT INTO league_competition_teams(id,competition_id,season_team_id) VALUES ('ct-other','comp-other','st-other');");
      seedRoster("roster-c","player-c","team-a","7","active","season-other","comp-other");
    }
    await reactivateBaseRoster();
    expect(local.prepare("SELECT status,shirt_number FROM league_roster_memberships WHERE id='roster-a'").get())
      .toEqual({status:"active",shirt_number:"7"});
  });

  it("keeps imported legacy duplicate memberships readable", async () => {
    local.exec("INSERT INTO league_seasons(id,name,slug,status) VALUES ('season-old','2023-24','2023-24','completed'); INSERT INTO league_competitions(id,organization_id,season_id,name,slug,status) VALUES ('comp-old','org-a','season-old','Legacy Competition','legacy','completed'); INSERT INTO league_competition_formats(competition_id,expected_team_count) VALUES ('comp-old',4); INSERT INTO league_season_teams(id,season_id,team_id,display_name) VALUES ('st-old','season-old','team-a','Team A'); INSERT INTO league_competition_teams(id,competition_id,season_team_id) VALUES ('ct-old','comp-old','st-old');");
    seedOwnedPlayer("player-c");
    seedOwnedPlayer("player-d");
    seedRoster("roster-c","player-c","team-a","7","active","season-old","comp-old");
    seedRoster("roster-d","player-d","team-a","7","active","season-old","comp-old");
    const response = await call("league?view=team-roster&seasonId=season-old&competitionId=comp-old&teamId=team-a");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.athletes.map((row:{player_id:string})=>row.player_id).sort()).toEqual(["player-c","player-d"]);
  });
});
