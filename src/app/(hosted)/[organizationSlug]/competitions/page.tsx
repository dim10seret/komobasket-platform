import type { Metadata } from "next";
import PublicCompetitionsView, { type PublicCompetitionsViewProps } from "@/components/competition/PublicCompetitionsView";
import HostedOrganizationHero from "@/components/hosted/HostedOrganizationHero";
import HostedOrganizationPublicShell from "@/components/hosted/HostedOrganizationPublicShell";
import { hostedOrganizationPath } from "@/lib/hosted-organization-routes";
import { resolveHostedPublicOrganization } from "@/services/hosted-public-organization.service";

type Props = Pick<PublicCompetitionsViewProps, "searchParams"> & { params: Promise<{ organizationSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const organization = await resolveHostedPublicOrganization((await params).organizationSlug);
  return { title: `Διοργανώσεις | ${organization.name}`, alternates: { canonical: `https://komobasket.gr${hostedOrganizationPath(organization.slug, "competitions")}` } };
}

export default async function HostedCompetitionsPage({ params, searchParams }: Props) {
  const organization = await resolveHostedPublicOrganization((await params).organizationSlug);
  const basePath = hostedOrganizationPath(organization.slug, "competitions");
  return <HostedOrganizationPublicShell organization={organization}><PublicCompetitionsView organizationId={organization.organizationId} basePath={basePath} searchParams={searchParams} pageHero={<HostedOrganizationHero siteCoverUrl={organization.siteCoverUrl} compact eyebrow={organization.name} title="Διοργανώσεις" description="Επιλέξτε σεζόν, διοργάνωση και φάση για να παρακολουθήσετε την επίσημη αγωνιστική εικόνα." />} /></HostedOrganizationPublicShell>;
}
