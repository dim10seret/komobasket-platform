import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicLiveGameView from "@/components/competition/PublicLiveGame";
import HostedOrganizationHero from "@/components/hosted/HostedOrganizationHero";
import HostedOrganizationPublicShell from "@/components/hosted/HostedOrganizationPublicShell";
import { hostedCompetitionGamePath, hostedLiveApiPath, hostedOrganizationPath } from "@/lib/hosted-organization-routes";
import { resolveHostedPublicOrganization } from "@/services/hosted-public-organization.service";
import { PublicLiveGameServiceError, readPublicLiveGameForOrganization } from "@/services/public-live-game.service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ organizationSlug: string; gameId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { organizationSlug, gameId } = await params;
  const organization = await resolveHostedPublicOrganization(organizationSlug);
  return { title: `LIVE | ${organization.name}`, alternates: { canonical: `https://komobasket.gr${hostedCompetitionGamePath(organization.slug, gameId, true)}` } };
}

export default async function HostedLiveGamePage({ params }: Props) {
  const { organizationSlug, gameId } = await params;
  const organization = await resolveHostedPublicOrganization(organizationSlug);
  const competitionsPath = hostedOrganizationPath(organization.slug, "competitions");
  let result;
  try { result = await readPublicLiveGameForOrganization(organization.organizationId, gameId); }
  catch (error) { if (error instanceof PublicLiveGameServiceError && error.code === "PUBLIC_LIVE_NOT_FOUND") notFound(); throw error; }
  return <HostedOrganizationPublicShell organization={organization}><HostedOrganizationHero siteCoverUrl={organization.siteCoverUrl} compact eyebrow={`${organization.name} Live`} title="Ζωντανή εξέλιξη αγώνα" />{result.kind === "game"
    ? <main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#123047,_#07131d_45%,_#020609)] px-3 py-5 text-white sm:px-6 sm:py-8"><div className="mx-auto max-w-[1500px]"><div className="mb-4 flex justify-end"><Link href={competitionsPath} className="rounded-xl border border-slate-600 px-3 py-2 text-sm font-bold hover:bg-slate-800">Πίσω</Link></div><PublicLiveGameView initialGame={result.game} endpoint={hostedLiveApiPath(organization.slug, gameId)} /></div></main>
    : <main className="min-h-[calc(100vh-5rem)] bg-zinc-100 px-4 py-16"><section className="mx-auto max-w-xl rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black">Ο αγώνας δεν είναι LIVE</h1><p className="mt-3 text-zinc-600">Η δημόσια ζωντανή προβολή θα ενεργοποιηθεί όταν ξεκινήσει το authoritative KomoControl Run.</p><Link href={competitionsPath} className="mt-6 inline-flex rounded-xl bg-zinc-950 px-5 py-3 font-bold text-white">Πρόγραμμα &amp; Αποτελέσματα</Link></section></main>}
  </HostedOrganizationPublicShell>;
}
