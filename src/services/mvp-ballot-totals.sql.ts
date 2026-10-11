/** One accepted ballot contributes one vote, regardless of its credential source. */
export const MVP_BALLOT_TOTALS_SQL = `
  SELECT contest_id, candidate_id, COUNT(*) AS votes
  FROM (
    SELECT contest_id, candidate_id FROM mvp_votes
    UNION ALL
    SELECT contest_id, candidate_id FROM mvp_google_votes
  ) accepted
  GROUP BY contest_id, candidate_id
`;
