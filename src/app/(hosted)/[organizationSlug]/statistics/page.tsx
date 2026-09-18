import type { Metadata } from "next";
import PublicCompetitionStatisticsView from "@/components/competition/PublicCompetitionStatistics";
import HostedOrganizationHero from "@/components/hosted/HostedOrganizationHero";
import HostedOrganizationPublicShell from "@/components/hosted/HostedOrganizationPublicShell";
import { hostedOrganizationPath } from "@/lib/hosted-organization-routes";
import { resolveHostedPublicOrganization } from "@/services/hosted-public-organization.service";
import { readPublicCompetitionStatisticsForOrganization } from "@/services/public-competition-statistics.service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ season?: string; competition?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const organization = await resolveHostedPublicOrganization((await params).organizationSlug);
  return { title: `Στατιστικά & MVP | ${organization.name}`, alternates: { canonical: `https://komobasket.gr${hostedOrganizationPath(organization.slug, "statistics")}` } };
}

export default async function HostedStatisticsPage({ params, searchParams }: Props) {
  const organization = await resolveHostedPublicOrganization((await params).organizationSlug);
  const query = await searchParams;
  const basePath = hostedOrganizationPath(organization.slug, "statistics");
  let data: Awaited<ReturnType<typeof readPublicCompetitionStatisticsForOrganization>> | null = null;
  try { data = await readPublicCompetitionStatisticsForOrganization(organization.organizationId, { seasonSlug: query.season, competitionSlug: query.competition }); } catch {}
  return <HostedOrganizationPublicShell organization={organization}>
    <HostedOrganizationHero compact eyebrow={`${organization.name} Leaders`} title={<>ΣΤΑΤΙΣΤΙΚΑ &amp; MVP</>} description="Κορυφαίες επιδόσεις και στατιστικά των διοργανώσεων του Οργανισμού." />
    <main className="min-h-[calc(100vh-5rem)] bg-stone-50 py-8 sm:py-12"><section className="mx-auto max-w-7xl px-4 sm:px-6">{data ? <PublicCompetitionStatisticsView data={data} basePath={basePath} /> : <p className="rounded-3xl border border-zinc-200 bg-white p-8 font-bold text-zinc-600">Τα στατιστικά δεν είναι διαθέσιμα αυτή τη στιγμή.</p>}</section></main>
  </HostedOrganizationPublicShell>;
}
