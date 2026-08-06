import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Header from "../../components/layout/Header";

export const metadata: Metadata = {
  title: "Η Ταυτότητα του KomoBasket",
  description:
    "Η δημιουργία, το όραμα και οι στόχοι του KomoBasket League.",
};

export default function IdentityPage() {
  return (
    <>
      <Header />

      <main className="bg-zinc-100 pb-20">
        <section className="relative overflow-hidden bg-zinc-950 py-20 text-white sm:py-24">
          <Image
            src="/images/hero/hero.jpg"
            alt=""
            fill
            priority
            className="object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/70 to-zinc-950" />

          <div className="relative z-10 mx-auto max-w-5xl px-6 text-center">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-orange-500">
              Το όραμα πίσω από τη διοργάνωση
            </p>
            <h1 className="mt-4 text-4xl leading-tight font-black sm:text-5xl md:text-6xl">
              Η Ταυτότητα του KomoBasket
            </h1>
            <div className="mx-auto mt-7 h-1 w-20 rounded-full bg-orange-500" />
          </div>
        </section>

        <section className="mx-auto -mt-8 max-w-5xl px-6">
          <article className="relative rounded-3xl border border-zinc-200 bg-white px-7 py-9 shadow-xl sm:px-12 sm:py-12">
            <div className="space-y-7 text-lg leading-9 text-zinc-700">
              <p>
                <strong className="font-black text-zinc-950">
                  Το KomoBasket League
                </strong>{" "}
                αποτελεί έναν σύγχρονο θεσμό οργανωμένης αγωνιστικής
                καλαθοσφαίρισης ενηλίκων, που δημιουργήθηκε με στόχο να
                προσφέρει ένα ποιοτικό, αξιόπιστο και διαρκώς εξελισσόμενο
                αγωνιστικό περιβάλλον.
              </p>

              <p>
                Η ιδέα του KomoBasket γεννήθηκε το{" "}
                <strong className="font-black text-orange-600">2018</strong>{" "}
                ως ένα όραμα αποτυπωμένο στο χαρτί. Με συνέπεια, σχεδιασμό και
                συνεχή προσπάθεια, εξελίχθηκε σε μια ολοκληρωμένη διοργάνωση
                που σήμερα αποτελεί σημείο αναφοράς για την περιοχή,
                προάγοντας τη{" "}
                <strong className="font-black text-zinc-950">
                  δια βίου άθληση
                </strong>
                , τη συνεργασία, την κοινωνική προσφορά και την εξωστρέφεια.
              </p>

              <p>
                Μέσα από τη συνεργασία με θεσμικούς, εκπαιδευτικούς και
                κοινωνικούς φορείς, το KomoBasket επιδιώκει να συνδέσει τον
                αθλητισμό με την εκπαίδευση, τον εθελοντισμό, την τοπική
                ανάπτυξη και τον αθλητικό τουρισμό. Βασικός του στόχος
                παραμένει η συνεχής αναβάθμιση της διοργάνωσης και η
                καθιέρωσή της ως ενός πρότυπου θεσμού ερασιτεχνικής
                καλαθοσφαίρισης.
              </p>

              <p>
                Από το 2022 στέγη του KomoBasket είναι ο Σύνδεσμος Βετεράνων
                &amp; Ερασιτεχνών Καλαθοσφαίρισης Κομοτηνής. Ο ΣΒΕΚΚΟ και το
                KomoBasket αποτελούν δύο άρρηκτα συνδεδεμένες εκφράσεις.
                Μοιράζονται τις ίδιες αξίες, την ίδια αγάπη για τον αθλητισμό
                και έναν κοινό προσανατολισμό: τη δημιουργία δράσεων που
                ενώνουν τους ανθρώπους και προσφέρουν στην κοινωνία της
                Κομοτηνής.
              </p>

              <p>
                Η σχέση τους βασίζεται σε μια κοινή πορεία, μέσα από την οποία
                η εμπειρία, οι άνθρωποι και οι ιδέες λειτουργούν
                συμπληρωματικά, χωρίς κανένας από τους δύο να χάνει τη δική του
                ταυτότητα.
              </p>

              <p>
                Μέσα από το KomoBasket League, αυτή η στενή σχέση αποκτά
                ουσιαστική παρουσία και μετατρέπεται σε μια ζωντανή αθλητική
                διοργάνωση με ξεχωριστό χαρακτήρα και ισχυρούς δεσμούς με την
                πόλη.
              </p>
            </div>

            <div className="mt-10 border-t border-zinc-200 pt-8">
              <Link
                href="/"
                className="inline-flex rounded-xl bg-orange-600 px-6 py-3 font-bold text-white transition hover:bg-orange-700"
              >
                Επιστροφή στην Αρχική
              </Link>
            </div>
          </article>
        </section>
      </main>
    </>
  );
}
