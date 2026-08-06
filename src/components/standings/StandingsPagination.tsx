export default function StandingsPagination() {
  return (
    <section className="bg-zinc-100 pb-16">

      <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-6">

        <button className="rounded-lg border border-zinc-300 bg-white px-4 py-2 transition hover:bg-orange-500 hover:text-white">
          Προηγούμενη
        </button>

        <button className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white">
          1
        </button>

        <button className="rounded-lg border border-zinc-300 bg-white px-4 py-2 transition hover:bg-orange-500 hover:text-white">
          2
        </button>

        <button className="rounded-lg border border-zinc-300 bg-white px-4 py-2 transition hover:bg-orange-500 hover:text-white">
          3
        </button>

        <button className="rounded-lg border border-zinc-300 bg-white px-4 py-2 transition hover:bg-orange-500 hover:text-white">
          Επόμενη
        </button>

      </div>

    </section>
  );
}