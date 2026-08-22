import Image from "next/image";
import { listSupporters, type Supporter } from "@/services/supporters.service";

export default async function SupportersFooter() {
  let supporters: Supporter[] = [];
  try {
    supporters = await listSupporters("organization_komobasket", true);
  } catch {
    supporters = [];
  }
  if (!supporters.length) return null;
  return <footer className="border-t border-zinc-200 bg-white px-6 py-10">
    <div className="mx-auto flex max-w-7xl flex-col items-center">
      <h2 className="text-center text-sm font-black uppercase tracking-[.2em] text-zinc-500">Υποστηρικτές &amp; Συνεργάτες</h2>
      <div className="mx-auto mt-7 flex max-w-5xl flex-wrap justify-center gap-5">
        {supporters.map((supporter) => {
          const image = <Image src={supporter.logo_url} alt={`Λογότυπο ${supporter.name}`} width={180} height={96} className="h-20 w-full object-contain" />;
          return supporter.website_url ? <a key={supporter.id} href={supporter.website_url} target="_blank" rel="noopener noreferrer" aria-label={`Ιστοσελίδα ${supporter.name}`} className="flex h-20 w-[calc(50%-10px)] max-w-40 items-center rounded-2xl p-3 transition hover:bg-orange-50 sm:w-40">{image}</a> : <div key={supporter.id} className="flex h-20 w-[calc(50%-10px)] max-w-40 items-center rounded-2xl p-3 sm:w-40">{image}</div>;
        })}
      </div>
    </div>
  </footer>;
}
