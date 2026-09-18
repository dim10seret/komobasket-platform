import Header from "@/components/layout/Header";
import StandingsHeader from "@/components/standings/StandingsHeader";
import StandingsTable from "@/components/standings/StandingsTable";

export default function StandingsPage() {
  return (
    <>
      <Header />

      <main>

        <StandingsHeader />

        <StandingsTable />

      </main>
    </>
  );
}
