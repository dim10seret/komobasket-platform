import type { Metadata } from "next";
import HostedOrganizationHero from "@/components/hosted/HostedOrganizationHero";
import HostedOrganizationPublicShell from "@/components/hosted/HostedOrganizationPublicShell";
import { hostedOrganizationPath } from "@/lib/hosted-organization-routes";
import { resolveHostedPublicOrganization } from "@/services/hosted-public-organization.service";
import { listSupporters, type Supporter } from "@/services/supporters.service";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ organizationSlug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { organizationSlug } = await params;
  const organization = await resolveHostedPublicOrganization(organizationSlug);
  return { title: `Υποστηρικτές | ${organization.name}`, alternates: { canonical: `https://komobasket.gr${hostedOrganizationPath(organization.slug, "supporters")}` } };
}

export default async function HostedSupportersPage({ params }: PageProps) {
  const { organizationSlug } = await params;
  const organization = await resolveHostedPublicOrganization(organizationSlug);
  let supporters: Supporter[] = [];
  try { supporters = await listSupporters(organization.organizationId, true); } catch { supporters = []; }
  return <HostedOrganizationPublicShell organization={organization}><main className="bg-zinc-100 pb-20">
    <HostedOrganizationHero siteCoverUrl={organization.siteCoverUrl} compact centered eyebrow={organization.name} title={<>Υποστηρικτές &amp; Συνεργάτες</>} />
    <section className="mx-auto max-w-7xl px-6 py-14">
      {supporters.length === 0 ? <p className="rounded-3xl border border-zinc-200 bg-white p-8 text-center font-bold text-zinc-600 shadow-sm">Δεν υπάρχουν ακόμη ενεργοί υποστηρικτές.</p> : <div className="grid gap-6 md:grid-cols-2">{supporters.map((supporter) => <article key={supporter.id} className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex min-h-40 items-center justify-center rounded-2xl bg-zinc-50 p-6"><img src={supporter.logo_url} alt={`Λογότυπο ${supporter.name}`} className="max-h-32 max-w-full object-contain" /></div>
        <h2 className="mt-6 text-2xl font-black text-zinc-950">{supporter.name}</h2>{supporter.description && <p className="mt-3 leading-7 text-zinc-600">{supporter.description}</p>}
        {supporter.website_url && <a href={supporter.website_url} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex rounded-xl bg-orange-600 px-5 py-3 font-black text-white hover:bg-orange-700">Επίσημη ιστοσελίδα</a>}
      </article>)}</div>}
    </section>
  </main></HostedOrganizationPublicShell>;
}
