import Header from "../../components/layout/Header";
import TeamsHeader from "../../components/teams/TeamsHeader";
import TeamsGrid from "../../components/teams/TeamsGrid";

export default function TeamsPage() {
  return (
    <>
      <Header />

      <main>

        <TeamsHeader />

        <TeamsGrid />
    

      </main>
    </>
  );
}
