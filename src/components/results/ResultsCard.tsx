type ResultsCardProps = {
  round: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  date: string;
  venue: string;
};

export default function ResultsCard({
  round,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  status,
  date,
  venue,
}: ResultsCardProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:shadow-lg">

      <div className="flex items-center justify-between">

        <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-600">
          {round}
        </span>

        <span className="text-sm font-semibold text-green-600">
          {status}
        </span>

      </div>

      <div className="mt-8">

        <div className="flex items-center justify-between">

          <span className="text-lg font-bold text-zinc-900">
            {homeTeam}
          </span>

          <span className="text-3xl font-black text-orange-600">
            {homeScore}
          </span>

        </div>

        <div className="my-4 border-t border-dashed border-zinc-300"></div>

        <div className="flex items-center justify-between">

          <span className="text-lg font-bold text-zinc-900">
            {awayTeam}
          </span>

          <span className="text-3xl font-black text-zinc-900">
            {awayScore}
          </span>

        </div>

      </div>

      <div className="mt-8 space-y-2 text-sm text-zinc-500">

        <p>{date}</p>

        <p>{venue}</p>

      </div>

      <button className="mt-8 w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white transition hover:bg-orange-600">
        Λεπτομέρειες
      </button>

    </div>
  );
}