import { notFound } from "next/navigation";
import Header from "@/components/layout/Header";
import MvpVotingPage from "@/components/mvp/MvpVotingPage";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { readCompetitionDetailWithDb } from "@/services/public-mobile-competition.service";
import { readPublicMvpContestsWithDb } from "@/services/public-mvp-contests.service";

export const dynamic = "force-dynamic";

const VALID_ID = /^[A-Za-z0-9_-]{1,160}$/;

export default async function PublicMvpVotingPage({ params }: { params: Promise<{
  competitionId: string; rootPhaseId: string; contestId: string;
}> }) {
  const { competitionId, rootPhaseId, contestId } = await params;
  if (![competitionId, rootPhaseId, contestId].every((id) => VALID_ID.test(id))) notFound();
  const env = await getKomoBasketCloudflareEnv();
  if (env?.MVP_PUBLIC_READ_ENABLED !== "enabled" || !env.NEWS_DB) notFound();

  let data;
  try {
    data = await Promise.all([
      readPublicMvpContestsWithDb(env.NEWS_DB, { competitionId, rootPhaseId }),
      readCompetitionDetailWithDb(env.NEWS_DB, competitionId),
    ]);
  } catch { notFound(); }
  const [feed, competition] = data;
  const tournament = competition.tournamentGroups.find((group) => group.id === rootPhaseId);
  const contest = [...feed.active, ...feed.history].find((item) => item.id === contestId);
  if (!tournament || !contest) notFound();
  return <><Header /><MvpVotingPage
    initialContest={contest}
    initialServerTime={feed.serverTime}
    competitionId={competitionId}
    rootPhaseId={rootPhaseId}
    competitionName={competition.name}
    tournamentName={tournament.name}
    authEnabled={env.MVP_GOOGLE_AUTH_ENABLED === "enabled"}
    votingEnabled={env.MVP_GOOGLE_VOTING_ENABLED === "enabled"}
  /></>;
}
