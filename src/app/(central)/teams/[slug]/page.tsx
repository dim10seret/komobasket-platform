import { notFound } from "next/navigation";

import Header from "@/components/layout/Header";
import TeamHero from "@/components/team/TeamHero";
import TeamBreadcrumb from "@/components/team/TeamBreadcrumb";
import TeamTabs from "@/components/team/TeamTabs";

import { getTeamBySlug } from "@/services/team.service";
import { getPublicHistoricalTeamLogos } from "@/services/public-historical-team-logos.service";
import { getPlayersByTeam } from "@/services/player.service";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function TeamPage({ params }: PageProps) {
  const { slug } = await params;

  const team = getTeamBySlug(slug);
  const logos = await getPublicHistoricalTeamLogos();

  if (!team) {
    notFound();
  }

  const players = getPlayersByTeam(team.slug, team.season);

  return (
    <>
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-10">
        <TeamBreadcrumb team={team.name} />

        <TeamHero
          team={team.name}
          season={team.season}
          playerCount={players.length}
          logo={logos[team.slug] ?? ""}
        />

        <div className="mt-10">
          <TeamTabs teamSlug={team.slug} season={team.season} />
        </div>
      </main>
    </>
  );
}
