import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicFinalizedGame from "@/components/competition/PublicFinalizedGame";
import HostedOrganizationHero from "@/components/hosted/HostedOrganizationHero";
import HostedOrganizationPublicShell from "@/components/hosted/HostedOrganizationPublicShell";
import { hostedCompetitionGamePath, hostedOrganizationPath } from "@/lib/hosted-organization-routes";
import { readPublicFinalizedGameForOrganization } from "@/services/public-finalized-game.service";
import { resolveHostedPublicOrganization } from "@/services/hosted-public-organization.service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ organizationSlug: string; gameId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { organizationSlug, gameId } = await params;
  const organization = await resolveHostedPublicOrganization(organizationSlug);
  return { title: `Αγώνας | ${organization.name}`, alternates: { canonical: `https://komobasket.gr${hostedCompetitionGamePath(organization.slug, gameId)}` } };
}

export default async function HostedFinalizedGamePage({ params }: Props) {
  const { organizationSlug, gameId } = await params;
  const organization = await resolveHostedPublicOrganization(organizationSlug);
  const result = await readPublicFinalizedGameForOrganization(organization.organizationId, gameId);
  if (result.kind !== "game") notFound();
  const competitionsPath = hostedOrganizationPath(organization.slug, "competitions");
  return <HostedOrganizationPublicShell organization={organization}><HostedOrganizationHero compact eyebrow={organization.name} title="Αγώνας" description="Επίσημο αποτέλεσμα και φύλλο αγώνα." /><main className="min-h-[calc(100vh-5rem)] bg-stone-50 px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto max-w-7xl"><Link href={competitionsPath} className="mb-6 inline-flex min-h-11 items-center rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-black text-zinc-800 shadow-sm hover:border-zinc-950">← Επιστροφή στη διοργάνωση</Link><PublicFinalizedGame detail={result.game} /></div></main></HostedOrganizationPublicShell>;
}
