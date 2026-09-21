import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "Όροι Χρήσης",
  description: "Βασικοί όροι χρήσης του ιστότοπου και της πλατφόρμας KomoBasket.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-5rem)] bg-zinc-100 pb-20">
        <header className="bg-zinc-950 px-6 py-14 text-white sm:py-20">
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-500">KomoBasket Platform</p>
            <h1 className="mt-4 text-4xl font-black sm:text-5xl">Όροι Χρήσης</h1>
            <p className="mt-5 text-sm text-zinc-300">Τελευταία ενημέρωση: 21 Σεπτεμβρίου 2026</p>
          </div>
        </header>

        <article className="mx-auto mt-8 max-w-4xl space-y-8 rounded-3xl border border-zinc-200 bg-white px-6 py-8 text-base leading-8 text-zinc-700 shadow-sm sm:px-10 sm:py-12">
          <section>
            <h2 className="text-2xl font-black text-zinc-950">Χρήση του KomoBasket</h2>
            <p className="mt-3">Ο δημόσιος ιστότοπος παρουσιάζει νέα, διοργανώσεις, αγώνες και στατιστικά. Το δημόσιο περιεχόμενο έχει ενημερωτικό χαρακτήρα και μπορεί να ενημερώνεται ή να διορθώνεται όταν προκύπτουν νεότερα στοιχεία.</p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-zinc-950">Περιορισμένη πρόσβαση</h2>
            <p className="mt-3">Οι περιοχές διαχείρισης προορίζονται μόνο για εξουσιοδοτημένους χρήστες. Κάθε χρήστης οφείλει να χρησιμοποιεί τον λογαριασμό του μόνο για τις αρμοδιότητές του, να προστατεύει τα στοιχεία σύνδεσής του και να ενημερώνει την ομάδα KomoBasket αν υποψιάζεται μη εξουσιοδοτημένη πρόσβαση.</p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-zinc-950">Περιεχόμενο και αποδεκτή χρήση</h2>
            <p className="mt-3">Κείμενα, σήματα, εικόνες και λοιπό περιεχόμενο ανήκουν στους αντίστοιχους δικαιούχους τους. Η χρήση του ιστότοπου δεν παρέχει άδεια αναδημοσίευσης πέρα από ό,τι επιτρέπεται από τον δικαιούχο ή την εφαρμοστέα νομοθεσία. Δεν επιτρέπεται χρήση που παρεμποδίζει τη λειτουργία της υπηρεσίας, παρακάμπτει ελέγχους πρόσβασης ή παραβιάζει δικαιώματα τρίτων.</p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-zinc-950">Διαθεσιμότητα και τρίτες υπηρεσίες</h2>
            <p className="mt-3">Η λειτουργία και το περιεχόμενο της υπηρεσίας ενδέχεται να αλλάζουν ή να διακόπτονται προσωρινά για τεχνικούς λόγους. Καταβάλλεται προσπάθεια για ακριβή και διαθέσιμη ενημέρωση, χωρίς να μπορεί να αποκλειστεί κάθε σφάλμα ή διακοπή. Σύνδεσμοι και λειτουργίες που σχετίζονται με τρίτες υπηρεσίες, όπως η Meta/Facebook, διέπονται και από τους δικούς τους όρους.</p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-zinc-950">Επικοινωνία</h2>
            <p className="mt-3">Για ερωτήσεις σχετικά με τον ιστότοπο ή αυτούς τους όρους, χρησιμοποιήστε τη <Link href="/contact" className="font-bold text-orange-700 underline underline-offset-4 hover:text-orange-800">φόρμα επικοινωνίας</Link>.</p>
          </section>
        </article>
      </main>
    </>
  );
}
