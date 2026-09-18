import type { Metadata } from "next";
import HostedOrganizationHero from "@/components/hosted/HostedOrganizationHero";
import HostedOrganizationHomeData, { selectHostedHomePhaseContext } from "@/components/hosted/HostedOrganizationHomeData";
import HostedOrganizationPublicShell from "@/components/hosted/HostedOrganizationPublicShell";
import { getPublicCompetitionContextForOrganization, type PublicCompetitionContext } from "@/services/public-competition.service";
import { resolveHostedPublicOrganization } from "@/services/hosted-public-organization.service";

type HostedHomeProps = {
  params: Promise<{ organizationSlug: string }>;
};

export async function generateMetadata({ params }: HostedHomeProps): Promise<Metadata> {
  const organization = await resolveHostedPublicOrganization((await params).organizationSlug);
  return {
    title: organization.name,
    alternates: {
      canonical: `https://komobasket.gr/${organization.slug}`,
    },
  };
}

export default async function HostedOrganizationHome({ params }: HostedHomeProps) {
  const organization = await resolveHostedPublicOrganization((await params).organizationSlug);
  let context: PublicCompetitionContext | null = null;
  let phaseContexts: PublicCompetitionContext[] = [];
  try {
    const defaultContext = await getPublicCompetitionContextForOrganization(organization.organizationId);
    const competitionSlug = defaultContext.selectedCompetition?.slug;
    if (competitionSlug && defaultContext.phases.length > 0) {
      phaseContexts = await Promise.all(defaultContext.phases.map((phase) =>
        getPublicCompetitionContextForOrganization(organization.organizationId, {
          competitionSlug,
          phaseSlug: phase.slug,
        })));
      context = selectHostedHomePhaseContext(phaseContexts) ?? defaultContext;
    } else {
      context = defaultContext;
      phaseContexts = [defaultContext];
    }
  } catch {}
  return <HostedOrganizationPublicShell organization={organization}>
    <main>
      <HostedOrganizationHero
        title={organization.name}
        rightAligned
      />
      <HostedOrganizationHomeData organizationSlug={organization.slug} context={context} phaseContexts={phaseContexts} />
    </main>
  </HostedOrganizationPublicShell>;
}
