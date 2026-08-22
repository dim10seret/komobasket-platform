import Image from "next/image";
import Header from "../../components/layout/Header";
import { listSupporters, type Supporter } from "@/services/supporters.service";

export default async function SupportersPage() {
  let supporters: Supporter[] = [];
  try {
    supporters = await listSupporters("organization_komobasket", true);
  } catch {
    supporters = [];
  }
  return (
    <>
      <Header />
      <main className="bg-zinc-100 pb-20">
        <section className="bg-zinc-950 py-20 text-white">
          <div className="mx-auto max-w-7xl px-6 text-center">
            <p className="font-bold uppercase tracking-[0.2em] text-orange-500">Μαζί για το KomoBasket League</p>
            <h1 className="mt-4 text-5xl font-black">Υποστηρικτές & Συνεργάτες</h1>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-zinc-300">
              Φορείς που στηρίζουν τη διοργάνωση και συμβάλλουν ουσιαστικά στην ανάπτυξη του αθλητισμού και της τοπικής κοινωνίας.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-7xl space-y-10 px-6 py-16">
          {supporters.map((supporter) => (
            <article key={supporter.name} className="grid overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-lg lg:grid-cols-[360px_1fr]">
              {supporter.website_url ? <a
                href={supporter.website_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Επίσημη ιστοσελίδα: ${supporter.name}`}
                className="group flex min-h-72 items-center justify-center bg-zinc-50 p-8 transition hover:bg-orange-50"
              >
                <div className="relative h-64 w-full">
                  <Image src={supporter.logo_url} alt={`Λογότυπο ${supporter.name}`} fill sizes="(max-width: 1024px) 100vw, 360px" className="object-contain transition duration-300 group-hover:scale-105" />
                </div>
              </a> : <div className="flex min-h-72 items-center justify-center bg-zinc-50 p-8">
                <div className="relative h-64 w-full">
                  <Image src={supporter.logo_url} alt={`Λογότυπο ${supporter.name}`} fill sizes="(max-width: 1024px) 100vw, 360px" className="object-contain" />
                </div>
              </div>}
              <div className="p-7 md:p-10">
                <h2 className="text-2xl font-black leading-tight text-zinc-900 md:text-3xl">{supporter.name}</h2>
                <div className="mt-6 space-y-4 leading-8 text-zinc-600">
                  {supporter.description && <p>{supporter.description}</p>}
                </div>
                {supporter.website_url && <a href={supporter.website_url} target="_blank" rel="noreferrer" className="mt-7 inline-flex rounded-xl bg-orange-600 px-5 py-3 font-bold text-white transition hover:bg-orange-700">
                  Επίσημη ιστοσελίδα
                </a>}
              </div>
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
