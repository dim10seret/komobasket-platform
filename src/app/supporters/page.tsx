import Image from "next/image";
import Header from "../../components/layout/Header";

const supporters = [
  {
    name: "Ελληνικός Ερυθρός Σταυρός – Περιφερειακό Τμήμα Κομοτηνής",
    url: "https://www.facebook.com/komotiniredcross/?locale=el_GR",
    logo: "/images/supporters/erithros-stauros-komotinis.jpg",
    description: [
      "Το Περιφερειακό Τμήμα Κομοτηνής του Ελληνικού Ερυθρού Σταυρού αποτελεί έναν διαχρονικό και πολύτιμο υποστηρικτή του KomoBasket, προσφέροντας με συνέπεια την υγειονομική κάλυψη των αγώνων μέσω των εθελοντών Σαμαρειτών του. Η διαρκής παρουσία τους συμβάλλει καθοριστικά στην ασφαλή διεξαγωγή της διοργάνωσης, αναδεικνύοντας τις αξίες του εθελοντισμού, της αλληλεγγύης και της κοινωνικής προσφοράς. Το KomoBasket εκφράζει την ειλικρινή του εκτίμηση για τη διαχρονική αυτή συνεργασία, η οποία ενισχύει το αίσθημα ασφάλειας όλων των συμμετεχόντων.",
    ],
  },
  {
    name: "Δήμος Κομοτηνής",
    url: "https://komotini.gr/",
    logo: "/images/supporters/dimos-komotinis.jpg",
    description: [
      "Ο Δήμος Κομοτηνής αποτελεί σταθερό υποστηρικτή του KomoBasket, συμβάλλοντας ουσιαστικά στην ανάπτυξη του αθλητισμού και στην ενίσχυση δράσεων που φέρνουν τους πολίτες πιο κοντά. Μέσα από αυτή τη συνεργασία δημιουργούνται περισσότερες ευκαιρίες συμμετοχής, διά βίου άθλησης και δημιουργικής έκφρασης, ενώ παράλληλα προβάλλονται οι αξίες της ομαδικότητας και του ευ αγωνίζεσθαι. Το KomoBasket αναδεικνύει τη διαρκή προσφορά του Δήμου και ενισχύει την κοινή προσπάθεια για μια πόλη δραστήρια, εξωστρεφή και ανοιχτή σε όλους.",
    ],
  },
  {
    name: "Σχολή Επιστήμης Φυσικής Αγωγής και Αθλητισμού – Δημοκρίτειο Πανεπιστήμιο Θράκης",
    url: "https://duth.gr/schools/phyed/",
    logo: "/images/supporters/sefaa-duth.jpg",
    description: [
      "Η Σχολή Επιστήμης Φυσικής Αγωγής και Αθλητισμού του Δημοκρίτειου Πανεπιστημίου Θράκης αποτελεί σημαντικό ακαδημαϊκό και επιστημονικό υποστηρικτή του KomoBasket. Η συνεργασία συνδέει τη γνώση, την έρευνα και την εκπαιδευτική εμπειρία με τη ζωντανή πραγματικότητα μιας σύγχρονης αθλητικής διοργάνωσης, δημιουργώντας πεδίο πρακτικής εφαρμογής και ενεργού συμμετοχής για φοιτητές και μέλη της ακαδημαϊκής κοινότητας. Παράλληλα, ενισχύει την ανταλλαγή τεχνογνωσίας, την ανάπτυξη καινοτόμων δράσεων και τη διαμόρφωση μιας ισχυρής γέφυρας ανάμεσα στο Πανεπιστήμιο, τον αθλητισμό και την τοπική κοινωνία.",
    ],
  },
];

export default function SupportersPage() {
  return (
    <>
      <Header />
      <main className="bg-zinc-100 pb-20">
        <section className="bg-zinc-950 py-20 text-white">
          <div className="mx-auto max-w-7xl px-6 text-center">
            <p className="font-bold uppercase tracking-[0.2em] text-orange-500">Μαζί για το KomoBasket League</p>
            <h1 className="mt-4 text-5xl font-black">Υποστηρικτές & Συνεργάτες</h1>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-zinc-300">
              Φορείς που στηρίζουν τη διοργάνωση και συμβάλλουν ουσιαστικά στην ανάπτυξη του αθλητισμού και της τοπικής κοινωνίας.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-7xl space-y-10 px-6 py-16">
          {supporters.map((supporter) => (
            <article key={supporter.name} className="grid overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-lg lg:grid-cols-[360px_1fr]">
              <a
                href={supporter.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Επίσημη ιστοσελίδα: ${supporter.name}`}
                className="group flex min-h-72 items-center justify-center bg-zinc-50 p-8 transition hover:bg-orange-50"
              >
                <div className="relative h-64 w-full">
                  <Image src={supporter.logo} alt={`Λογότυπο ${supporter.name}`} fill sizes="(max-width: 1024px) 100vw, 360px" className="object-contain transition duration-300 group-hover:scale-105" />
                </div>
              </a>
              <div className="p-7 md:p-10">
                <h2 className="text-2xl font-black leading-tight text-zinc-900 md:text-3xl">{supporter.name}</h2>
                <div className="mt-6 space-y-4 leading-8 text-zinc-600">
                  {supporter.description.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
                <a href={supporter.url} target="_blank" rel="noreferrer" className="mt-7 inline-flex rounded-xl bg-orange-600 px-5 py-3 font-bold text-white transition hover:bg-orange-700">
                  Επίσημη ιστοσελίδα
                </a>
              </div>
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
