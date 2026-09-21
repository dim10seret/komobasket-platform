import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "Διαγραφή Δεδομένων",
  description: "Οδηγίες για αίτημα διαγραφής προσωπικών δεδομένων στην πλατφόρμα KomoBasket.",
  alternates: { canonical: "/data-deletion" },
};

export default function DataDeletionPage() {
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-5rem)] bg-zinc-100 pb-20">
        <header className="bg-zinc-950 px-6 py-14 text-white sm:py-20">
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-500">KomoBasket Platform</p>
            <h1 className="mt-4 text-4xl font-black sm:text-5xl">Διαγραφή Δεδομένων</h1>
            <p className="mt-5 text-sm text-zinc-300">Τελευταία ενημέρωση: 21 Σεπτεμβρίου 2026</p>
          </div>
        </header>

        <article className="mx-auto mt-8 max-w-4xl space-y-8 rounded-3xl border border-zinc-200 bg-white px-6 py-8 text-base leading-8 text-zinc-700 shadow-sm sm:px-10 sm:py-12">
          <section>
            <h2 className="text-2xl font-black text-zinc-950">Πώς υποβάλλετε αίτημα</h2>
            <p className="mt-3">Αν θέλετε να ζητήσετε διαγραφή δεδομένων που σχετίζονται με τη χρήση της πλατφόρμας KomoBasket ή τη δημοσίευση ειδήσεων μέσω Meta/Facebook, ακολουθήστε τα παρακάτω βήματα:</p>
            <ol className="mt-4 list-decimal space-y-3 pl-6 marker:font-bold marker:text-orange-700">
              <li>Στείλτε μήνυμα μέσω της <Link href="/contact" className="font-bold text-orange-700 underline underline-offset-4 hover:text-orange-800">επίσημης φόρμας επικοινωνίας</Link>.</li>
              <li>Στο θέμα γράψτε «Αίτημα διαγραφής προσωπικών δεδομένων».</li>
              <li>Δώστε αρκετά στοιχεία για να εντοπίσουμε τον σχετικό λογαριασμό, μήνυμα ή δημοσίευση. Μην στείλετε κωδικό πρόσβασης.</li>
              <li>Η ομάδα KomoBasket θα επαληθεύσει το αίτημα όπου χρειάζεται και θα εξετάσει τη διαγραφή των δεδομένων που ελέγχει, λαμβάνοντας υπόψη τυχόν δεδομένα που πρέπει νόμιμα να διατηρηθούν.</li>
            </ol>
          </section>

          <section>
            <h2 className="text-2xl font-black text-zinc-950">Δεδομένα σε τρίτες υπηρεσίες</h2>
            <p className="mt-3">Η δημοσίευση ειδήσεων στην επίσημη σελίδα Facebook χρησιμοποιεί υπηρεσίες της Meta. Δεδομένα που τηρούνται ανεξάρτητα από τη Meta/Facebook υπόκεινται στα δικά της συστήματα και πολιτικές. Η ομάδα KomoBasket μπορεί να εξετάσει μόνο δεδομένα και δημοσιεύσεις που ελέγχει η ίδια.</p>
          </section>

          <section>
            <h2 className="text-2xl font-black text-zinc-950">Περισσότερες πληροφορίες</h2>
            <p className="mt-3">Για το πώς χρησιμοποιούνται τα δεδομένα στον ιστότοπο, διαβάστε την <Link href="/privacy" className="font-bold text-orange-700 underline underline-offset-4 hover:text-orange-800">Πολιτική Απορρήτου</Link>.</p>
          </section>
        </article>
      </main>
    </>
  );
}
