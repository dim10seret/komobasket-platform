import { listSupporters, type Supporter } from "@/services/supporters.service";

export default async function HostedSupportersFooter({ organizationId }: { organizationId: string }) {
  let supporters: Supporter[] = [];
  try {
    supporters = await listSupporters(organizationId, true);
  } catch {
    supporters = [];
  }
  if (!supporters.length) return null;

  return <footer className="border-t border-zinc-200 bg-white px-6 py-9">
    <div className="mx-auto max-w-7xl">
      <h2 className="text-center text-xs font-black uppercase tracking-[.2em] text-zinc-500">Υποστηρικτές &amp; Συνεργάτες</h2>
      <div className="mt-6 flex flex-wrap justify-center gap-5">
        {supporters.map((supporter) => {
          const logo = <img src={supporter.logo_url} alt={`Λογότυπο ${supporter.name}`} className="h-16 w-full object-contain" />;
          return supporter.website_url ? <a key={supporter.id} href={supporter.website_url} target="_blank" rel="noopener noreferrer" className="flex h-20 w-36 items-center rounded-xl p-2 transition hover:bg-orange-50" aria-label={`Ιστοσελίδα ${supporter.name}`}>{logo}</a> : <div key={supporter.id} className="flex h-20 w-36 items-center rounded-xl p-2">{logo}</div>;
        })}
      </div>
    </div>
  </footer>;
}
