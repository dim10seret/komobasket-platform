import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "Πολιτική Απορρήτου",
  description: "Πώς χρησιμοποιεί και προστατεύει δεδομένα η πλατφόρμα KomoBasket.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-5rem)] bg-zinc-100 pb-20">
        <header className="bg-zinc-950 px-6 py-14 text-white sm:py-20">
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-500">KomoBasket Platform</p>
            <h1 className="mt-4 text-4xl font-black sm:text-5xl">Πολιτική Απορρήτου</h1>
            <p className="mt-5 text-sm text-zinc-300">Τελευταία ενημέρωση: 21/09/2026</p>
          </div>
        </header>

        <article className="mx-auto mt-8 max-w-4xl space-y-8 rounded-3xl border border-zinc-200 bg-white px-6 py-8 text-base leading-8 text-zinc-700 shadow-sm sm:px-10 sm:py-12">
          <section>
            <h2 className="text-2xl font-black text-zinc-950">Η πλατφόρμα</h2>
            <p className="mt-3">Το KomoBasket παρουσιάζει ειδήσεις, διοργανώσεις, αγώνες και στατιστικά καλαθοσφαίρισης. Εξουσιοδοτημένοι χρήστες διαχειρίζονται περιεχόμενο και στοιχεία οργανισμών σε περιορισμένες περιοχές της πλατφόρμας.</p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-zinc-950">Δεδομένα που χρησιμοποιούμε</h2>
            <p className="mt-3">Η φόρμα επικοινωνίας ζητά ονοματεπώνυμο, email, θέμα και μήνυμα, ώστε να παραλάβουμε και να απαντήσουμε στο αίτημά σας. Για εξουσιοδοτημένους χρήστες χρησιμοποιούμε στοιχεία λογαριασμού, όπως email, όνομα όπου έχει οριστεί, ρόλο και πρόσβαση σε οργανισμό. Οι κωδικοί αποθηκεύονται ως hashes και οι συνεδρίες ελέγχονται από την εφαρμογή.</p>
            <p className="mt-3">Για την ασφάλεια της φόρμας και της σύνδεσης χρησιμοποιούνται τεχνικά στοιχεία που απαιτούνται για επαλήθευση, περιορισμό προσπαθειών και διάγνωση σφαλμάτων. Δημόσιες ειδήσεις και πληροφορίες αγώνων ενδέχεται να περιλαμβάνουν ονόματα, εικόνες ή αγωνιστικά στοιχεία όταν αυτά αποτελούν μέρος του δημοσιευμένου περιεχομένου.</p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-zinc-950">Υπηρεσίες και δημοσίευση στο Facebook</h2>
            <p className="mt-3">Η φόρμα επικοινωνίας χρησιμοποιεί Cloudflare Turnstile για επαλήθευση και υπηρεσία αποστολής email για την παράδοση του μηνύματος στην ομάδα KomoBasket. Εξουσιοδοτημένος διαχειριστής μπορεί να δημοσιεύσει ήδη δημοσιευμένη είδηση στην επίσημη σελίδα Facebook μέσω της Meta. Για αυτή τη λειτουργία αποστέλλονται ο τίτλος, σύντομο απόσπασμα και σύνδεσμος της είδησης. Δεν απαιτείται σύνδεση του επισκέπτη με λογαριασμό Facebook για τη χρήση του ιστότοπου.</p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-zinc-950">Cookies και ασφάλεια</h2>
            <p className="mt-3">Οι περιορισμένες περιοχές χρησιμοποιούν cookies συνεδρίας και μηχανισμούς ελέγχου πρόσβασης. Οι χρήστες οργανισμών συνδέονται με προστατευμένο cookie συνεδρίας, ενώ η πρόσβαση Super Admin ελέγχεται χωριστά μέσω Cloudflare Access. Τα δεδομένα χρησιμοποιούνται για τη λειτουργία της υπηρεσίας, την επικοινωνία, τη δημοσίευση περιεχομένου και την προστασία από μη εξουσιοδοτημένη χρήση.</p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-zinc-950">Διατήρηση και αιτήματα</h2>
            <p className="mt-3">Διατηρούμε δεδομένα όσο χρειάζονται για τους παραπάνω σκοπούς και για τυχόν εφαρμοστέες υποχρεώσεις. Μπορείτε να ζητήσετε πληροφορίες, πρόσβαση, διόρθωση ή διαγραφή δεδομένων που σας αφορούν μέσω της <Link href="/contact" className="font-bold text-orange-700 underline underline-offset-4 hover:text-orange-800">φόρμας επικοινωνίας</Link>. Για τη διαδικασία διαγραφής δείτε τη σελίδα <Link href="/data-deletion" className="font-bold text-orange-700 underline underline-offset-4 hover:text-orange-800">Διαγραφή Δεδομένων</Link>.</p>
          </section>
        </article>
      </main>
    </>
  );
}
