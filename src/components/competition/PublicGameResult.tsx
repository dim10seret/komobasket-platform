import Link from "next/link";

import type { PublicGame } from "@/services/public-competition.service";

export function publicFinalizedGameHref(
  game: PublicGame,
  gameBasePath = "/competitions/games",
): string | null {
  if (game.publicStatus !== "completed"
    || !game.finalizedStatisticsAvailable
    || game.homeScore === null
    || game.awayScore === null) return null;
  return `${gameBasePath}/${encodeURIComponent(game.id)}`;
}

export default function PublicGameResult({ game, className, gameBasePath }: { game: PublicGame; className: string; gameBasePath?: string }) {
  const hasResult = game.homeScore !== null && game.awayScore !== null;
  const label = hasResult ? `${game.homeScore} – ${game.awayScore}` : "vs";
  const href = publicFinalizedGameHref(game, gameBasePath);
  return href
    ? <Link href={href} aria-label={`Στατιστικά αγώνα ${label}`} className={`${className} inline-flex min-h-10 items-center justify-center transition hover:bg-orange-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600`}>{label}</Link>
    : <span className={className}>{label}</span>;
}
