import Link from "next/link";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { readPublicMvpContestsWithDb } from "@/services/public-mvp-contests.service";

type Feed = Awaited<ReturnType<typeof readPublicMvpContestsWithDb>>;
type Contest = Feed["active"][number];

const CANONICAL_ID = /^[A-Za-z0-9_-]{1,160}$/;

export function publicMvpContestHref(competitionId: string, rootPhaseId: string, contestId: string): string | null {
  if (![competitionId, rootPhaseId, contestId].every((id) => CANONICAL_ID.test(id))) return null;
  return `/mvp/competitions/${competitionId}/tournaments/${rootPhaseId}/contests/${contestId}`;
}

function contestLabel(contest: Contest): string {
  return contest.scopeType === "round"
    ? contest.roundNumber !== null ? `MVP ${contest.roundNumber}ης αγωνιστικής` : "MVP αγωνιστικής"
    : "MVP σειράς";
}

function closingTime(seconds: number): string {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens",
  }).format(new Date(seconds * 1000));
}

function ContestCard({ contest, competitionId, rootPhaseId, serverTime }: {
  contest: Contest; competitionId: string; rootPhaseId: string; serverTime: number;
}) {
  const href = publicMvpContestHref(competitionId, rootPhaseId, contest.id);
  if (!href) return null;
  const open = contest.status === "open" && serverTime >= contest.opensAt && serverTime < contest.closesAt;
  const finalized = contest.status === "finalized" && Boolean(contest.official?.winner);
  const status = open ? "Ανοιχτή" : finalized ? "Οριστικό MVP"
    : contest.status === "open" && serverTime < contest.opensAt ? "Δεν έχει ανοίξει"
      : contest.status === "open" ? "Έκλεισε" : "Αναμονή επίσημης απόφασης";
  return <article className="min-w-0 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
    <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-700">{contest.scopeType === "round" ? "Αγωνιστική" : "Σειρά"}</p>
    <h3 className="mt-1 text-lg font-black text-zinc-950">{contestLabel(contest)}</h3>
    <p className="mt-2 text-sm font-bold text-zinc-700">{status}</p>
    <p className="mt-1 text-sm text-zinc-600">Λήξη: <time dateTime={new Date(contest.closesAt * 1000).toISOString()}>{closingTime(contest.closesAt)}</time></p>
    {open || finalized ? <Link href={href} prefetch={false}
      className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-orange-600 px-5 py-2 font-black text-white hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600">
      {open ? "Δες την ψηφοφορία" : "Δες το επίσημο MVP"}
    </Link> : null}
  </article>;
}

export default async function PublicMvpDiscovery({ organizationId, competitionId, rootPhaseId }: {
  organizationId: string; competitionId: string; rootPhaseId: string;
}) {
  if (!CANONICAL_ID.test(competitionId) || !CANONICAL_ID.test(rootPhaseId)) return null;
  const env = await getKomoBasketCloudflareEnv();
  if (env?.MVP_PUBLIC_READ_ENABLED !== "enabled" || !env.NEWS_DB) return null;
  let feed: Feed;
  try {
    feed = await readPublicMvpContestsWithDb(env.NEWS_DB, { organizationId, competitionId, rootPhaseId });
  } catch { return null; }
  if (feed.organizationId !== organizationId || feed.competitionId !== competitionId
    || feed.rootPhaseId !== rootPhaseId) return null;
  const contests = [...feed.active, ...feed.history].filter((item) =>
    publicMvpContestHref(competitionId, rootPhaseId, item.id) !== null);
  return <section aria-labelledby="public-mvp-heading" className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
    <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Επίσημη διοργάνωση</p>
    <h2 id="public-mvp-heading" className="mt-2 text-2xl font-black">Ψηφοφορίες &amp; MVP</h2>
    {contests.length ? <div className="mt-5 grid gap-3 md:grid-cols-2">
      {contests.map((contest) => <ContestCard key={contest.id} contest={contest}
        competitionId={competitionId} rootPhaseId={rootPhaseId} serverTime={feed.serverTime} />)}
    </div> : <p className="mt-4 text-sm font-bold text-zinc-600">Δεν υπάρχουν διαθέσιμες ψηφοφορίες ή ανακοινώσεις MVP για αυτόν τον θεσμό.</p>}
  </section>;
}
