"use client";

import TeamRoster from "./TeamRoster";

interface TeamTabsProps {
  teamSlug: string;
  season: string;
}

export default function TeamTabs({ teamSlug, season }: TeamTabsProps) {
  return (
    <>
      <div className="flex gap-2 border-b border-zinc-800 mb-8">
        <button className="px-5 py-3 border-b-2 border-orange-500 text-white">
          Ρόστερ
        </button>
      </div>

      <TeamRoster teamSlug={teamSlug} season={season} />
    </>
  );
}
