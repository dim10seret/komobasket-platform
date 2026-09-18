import Header from "@/components/layout/Header";
import NBN23Widget from "@/components/nbn23/NBN23Widget";

export default function WidgetPage() {
  return (
    <>
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-10">
        <h1 className="text-4xl font-bold mb-8">
          NBN23 Widget
        </h1>

        <NBN23Widget />
      </main>
    </>
  );
}