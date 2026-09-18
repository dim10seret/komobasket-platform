import Image from "next/image";
import Link from "next/link";
import { PublicHomeCompetitiveBlocks, selectHostedHomePhaseContext } from "@/components/hosted/HostedOrganizationHomeData";
import Header from "@/components/layout/Header";
import {
  getPublicCompetitionContextForOrganization,
  type PublicCompetitionContext,
} from "@/services/public-competition.service";

export const dynamic = "force-dynamic";

const CENTRAL_KOMOBASKET_ORGANIZATION_ID = "organization_komobasket";

export default async function Home() {
  let context: PublicCompetitionContext | null = null;
  let phaseContexts: PublicCompetitionContext[] = [];

  try {
    const defaultContext = await getPublicCompetitionContextForOrganization(CENTRAL_KOMOBASKET_ORGANIZATION_ID);
    const competitionSlug = defaultContext.selectedCompetition?.slug;

    if (competitionSlug && defaultContext.phases.length > 0) {
      phaseContexts = await Promise.all(defaultContext.phases.map((phase) => getPublicCompetitionContextForOrganization(
        CENTRAL_KOMOBASKET_ORGANIZATION_ID,
        { competitionSlug, phaseSlug: phase.slug },
      )));
      context = selectHostedHomePhaseContext(phaseContexts) ?? defaultContext;
    } else {
      context = defaultContext;
      phaseContexts = [defaultContext];
    }
  } catch {
    context = null;
    phaseContexts = [];
  }

  return (
    <>
      <Header />

      <main>
        {/* HERO */}
        <section className="relative min-h-[calc(100svh-5rem)] overflow-hidden py-10 sm:h-[80vh] sm:min-h-0 sm:py-0">
          {/* Background */}
          <Image
            src="/images/hero/home-court.png"
            alt="Το γήπεδο του KomoBasket"
            fill
            priority
            sizes="100vw"
            className="origin-bottom scale-[1.8] object-cover object-bottom sm:scale-[1.6] lg:scale-[1.2]"
          />

          {/* Overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/70 to-black/90"></div>

          {/* Content */}
          <div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center justify-center px-6 text-center sm:h-full">
            {/* Logo */}
            <Image
              src="/logos/iconpn.png"
              alt="KomoBasket"
              width={300}
              height={300}
              priority
              className="h-auto w-[190px] drop-shadow-2xl sm:w-[240px] md:w-[300px]"
            />

            {/* Title */}
            <h1 className="mt-5 text-4xl leading-tight font-bold italic text-orange-500 sm:mt-8 sm:text-5xl md:text-6xl">
              Μια μπάλα, χίλιες ιστορίες
            </h1>

            <Link
              href="/identity"
              className="mt-5 inline-flex rounded-full border border-orange-500 bg-black/40 px-6 py-3 text-sm font-bold text-white backdrop-blur-sm transition hover:scale-105 hover:bg-orange-600 sm:mt-6 sm:text-base"
            >
              Η Ταυτότητα του KomoBasket
            </Link>

            {/* Description */}
            <p className="mt-5 max-w-4xl text-base leading-8 text-zinc-200 sm:mt-8 sm:text-xl sm:leading-10">
              Η επίσημη ιστοσελίδα των διοργανώσεων του KomoBasket.
              <br />
              Όλα τα νέα, οι αγώνες, τα αποτελέσματα, οι βαθμολογίες,
              οι ομάδες, τα βίντεο και οι σημαντικότερες στιγμές μιας
              διοργάνωσης που γράφει τη δική της ιστορία στην πόλη της Κομοτηνή.
            </p>
          </div>
        </section>

        <section className="bg-white px-5 py-16 sm:px-7 sm:py-20" aria-label="Αγωνιστική εικόνα KomoBasket">
          <div className="mx-auto max-w-6xl">
            <PublicHomeCompetitiveBlocks
              context={context}
              phaseContexts={phaseContexts}
              gameBasePath="/competitions/games"
              liveGameHref={(gameId) => `/competitions/games/${encodeURIComponent(gameId)}/live`}
            />
          </div>
        </section>
      </main>
    </>
  );
}
