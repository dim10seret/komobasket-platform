export default function ResultsFilters() {
  return (
    <section className="bg-zinc-100">

      <div className="mx-auto flex max-w-7xl flex-wrap gap-6 px-6 py-8">

        <div>

          <label className="mb-2 block text-sm font-semibold text-zinc-700">
            Διοργάνωση
          </label>

          <select className="w-64 rounded-xl border border-zinc-300 bg-white px-4 py-3">
            <option>KomoBasket League</option>
            <option>KomoCup</option>
          </select>

        </div>

        <div>

          <label className="mb-2 block text-sm font-semibold text-zinc-700">
            Σεζόν
          </label>

          <select className="w-48 rounded-xl border border-zinc-300 bg-white px-4 py-3">
            <option>2026-27</option>
            <option>2025-26</option>
            <option>2024-25</option>
          </select>

        </div>

      </div>

    </section>
  );
}