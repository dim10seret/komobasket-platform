import Header from "@/components/layout/Header";
import ResultsHeader from "@/components/results/ResultsHeader";
import ResultsGrid from "@/components/results/ResultsGrid";

export default function ResultsPage() {
  return (
    <>
      <Header />

      <main>

        <ResultsHeader />

        <ResultsGrid />

      </main>
    </>
  );
}
