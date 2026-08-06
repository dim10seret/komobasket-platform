export default function ScheduleFilters() {
  return (
    <section className="bg-zinc-100">
      <div className="mx-auto flex max-w-7xl flex-wrap gap-6 px-6 py-8">
        <div>
          <label htmlFor="schedule-competition" className="mb-2 block text-sm font-semibold text-zinc-700">
            Διοργάνωση
          </label>
          <select id="schedule-competition" defaultValue="league" className="w-64 rounded-xl border border-zinc-300 bg-white px-4 py-3">
            <option value="league">KomoBasket League</option>
            <option value="cup">KomoCup</option>
          </select>
        </div>

        <div>
          <label htmlFor="schedule-season" className="mb-2 block text-sm font-semibold text-zinc-700">
            Σεζόν
          </label>
          <select id="schedule-season" defaultValue="2024-25" className="w-48 rounded-xl border border-zinc-300 bg-white px-4 py-3">
            <option value="2024-25">2024-25</option>
          </select>
        </div>

        <div>
          <label htmlFor="schedule-round" className="mb-2 block text-sm font-semibold text-zinc-700">
            Αγωνιστική
          </label>
          <div className="w-48 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-600">15 αγωνιστικές</div>
        </div>
      </div>
    </section>
  );
}
