import Link from "next/link";

export default function NextGames() {
  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-10 text-center">
          <h2 className="text-4xl font-black text-zinc-900">Επόμενοι Αγώνες</h2>
        </div>

        <div className="mx-auto max-w-3xl rounded-2xl border border-zinc-200 bg-zinc-50 px-6 py-12 text-center shadow-sm">
          <p className="text-xl font-bold text-zinc-900">Δεν υπάρχουν προγραμματισμένοι αγώνες</p>
          <p className="mx-auto mt-3 max-w-2xl leading-7 text-zinc-600">
            Η αγωνιστική περίοδος έχει ολοκληρωθεί. Οι επόμενοι αγώνες θα εμφανιστούν εδώ μόλις αναρτηθεί το πρόγραμμα της νέας σεζόν.
          </p>
          <Link href="/schedule" className="mt-7 inline-flex rounded-xl bg-zinc-900 px-6 py-3 font-bold text-white transition hover:bg-orange-600">
            Δείτε το πρόγραμμα
          </Link>
        </div>
      </div>
    </section>
  );
}
