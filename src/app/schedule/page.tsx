import Header from "@/components/layout/Header";
import ScheduleGrid from "@/components/schedule/ScheduleGrid";
import ScheduleHeader from "@/components/schedule/ScheduleHeader";

export default function SchedulePage() {
  return (
    <>
      <Header />

      <main>
        <ScheduleHeader />
        <ScheduleGrid />
      </main>
    </>
  );
}
