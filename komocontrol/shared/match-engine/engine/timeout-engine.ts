import type { Team } from "../types/team.js";

export class TimeoutEngine {
  use(team: Team): boolean {
    if (team.timeouts === 0) return false;
    team.timeouts -= 1;
    return true;
  }
}
