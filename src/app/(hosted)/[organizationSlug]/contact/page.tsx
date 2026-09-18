import type { Metadata } from "next";
import ContactContent from "@/components/contact/ContactContent";
import HostedOrganizationHero from "@/components/hosted/HostedOrganizationHero";
import HostedOrganizationPublicShell from "@/components/hosted/HostedOrganizationPublicShell";
import { hostedOrganizationPath } from "@/lib/hosted-organization-routes";
import { resolveHostedPublicOrganization } from "@/services/hosted-public-organization.service";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ organizationSlug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { organizationSlug } = await params;
  const organization = await resolveHostedPublicOrganization(organizationSlug);
  return { title: `Επικοινωνία | ${organization.name}`, alternates: { canonical: `https://komobasket.gr${hostedOrganizationPath(organization.slug, "contact")}` } };
}

export default async function HostedContactPage({ params }: PageProps) {
  const { organizationSlug } = await params;
  const organization = await resolveHostedPublicOrganization(organizationSlug);
  return <HostedOrganizationPublicShell organization={organization}><ContactContent hostedOrganizationName={organization.name} hero={<HostedOrganizationHero compact centered eyebrow={organization.name} title="Επικοινωνία" />} /></HostedOrganizationPublicShell>;
}
