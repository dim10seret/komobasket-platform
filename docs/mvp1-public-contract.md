# MVP public read contract (proposed for MVP2/MVP4)

MVP1 creates no public route. The existing C1 `GET /api/public/v1/competitions/{competitionId}/mvp?phaseId=...&round=...` remains the Official Matchday MVP authority and keeps its current DTO and cache policy.

## Minimum future reads

- `GET /api/public/v1/competitions/{competitionId}/mvp-contests?rootPhaseId={rootPhaseId}` returns the current open contest and a small recent finalized list for the selected tournament root. The server derives and validates season, organization, phase, and root lineage using existing public-catalogue rules. A missing root filter may use the competition's existing default context.
- `GET /api/public/v1/mvp-contests/{contestId}` returns one public contest only after verifying that its organization, competition, and tournament are public. Neither route exposes operator data or unpublished contests.
- MVP2 adds `POST /api/public/v1/mvp-contests/{contestId}/vote`. No vote route exists in MVP1. Native-app voting uses a verified anonymous application credential; the website displays poll and publication data but directs voting to the app.

## Shared response shape

```json
{
  "data": {
    "id": "opaque-contest-id",
    "context": {
      "seasonId": "season-id",
      "organizationId": "organization-id",
      "competitionId": "competition-id",
      "rootPhaseId": "canonical-root-id"
    },
    "scope": {
      "type": "round",
      "phaseId": "phase-id",
      "roundNumber": 7,
      "matchupId": null
    },
    "status": "open",
    "resultsVisibility": "after_close",
    "opensAt": 1791547200,
    "closesAt": 1791720000,
    "serverTime": 1791547200,
    "candidates": [
      {
        "id": "opaque-candidate-id",
        "player": { "id": "player-id", "name": "Display name" },
        "team": { "id": "team-id", "name": "Team name" },
        "supportingPerformance": { "points": 24, "rebounds": 9, "assists": 5, "efficiency": 29 }
      }
    ],
    "results": null,
    "officialMvp": null
  }
}
```

For a series, `scope.type` is `series`, `roundNumber` is null, and `matchupId` is the existing bracket matchup ID within `phaseId`. Supporting performance statistics are one verified game, not series aggregates.

All timestamps are UTC Unix seconds. The client may animate a countdown using `closesAt - serverTime`, but the server clock alone controls vote acceptance. Reads containing `serverTime` or an integrity challenge require `no-store`.

While an `after_close` contest is open, public responses omit counts, percentages, totals, leaders, and vote-derived candidate order. `live` may include counts and totals. A finalized record includes its Official MVP, immutable supporting statistics snapshot, and optional photo/text/sponsor/gift fields from the same contest row. A closed tie or zero-vote contest shows that operator resolution is pending and does not invent a winner.

MVP2 must implement guarded vote writes and lazy finalization on genuine MVP reads. MVP1 contains only the authorized local start service and schema foundation.
