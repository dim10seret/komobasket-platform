import Header from "@/components/layout/Header";
import TeamsHeader from "@/components/teams/TeamsHeader";
import TeamsGrid from "@/components/teams/TeamsGrid";
import { CanonicalTeamLogoProvider } from "@/components/teams/CanonicalTeamLogoContext";
import { getPublicHistoricalTeamLogos } from "@/services/public-historical-team-logos.service";

export default async function TeamsPage() {
  const logos = await getPublicHistoricalTeamLogos();
  return (
    <>
      <Header />

      <main>

        <TeamsHeader />

        <CanonicalTeamLogoProvider logos={logos}><TeamsGrid /></CanonicalTeamLogoProvider>
    

      </main>
    </>
  );
}
