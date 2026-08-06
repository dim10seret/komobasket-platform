import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase-client";

export default function Settings() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  const signIn = async (register = false) => {
    if (!supabase) { setMessage("Δεν έχει ρυθμιστεί το Supabase."); return; }
    const result = register
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) { setMessage(result.error.message); return; }
    setSignedIn(true);
    setMessage(register ? "Ο λογαριασμός δημιουργήθηκε. Επιβεβαίωσε το email σου, αν ζητηθεί." : "Έγινε σύνδεση.");
  };

  const claimFirstAdmin = async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc("claim_first_admin");
    if (!error) { setMessage("Ο λογαριασμός έγινε ο πρώτος admin του KomoControl."); return; }
    setMessage(error.code === "23505" ? "Υπάρχει ήδη admin. Ζήτησε από τον admin να σου δώσει δικαιώματα." : error.message);
  };

  return <main className="live-match"><h1>Ρυθμίσεις και πρόσβαση</h1><section className="panel"><h2>Σύνδεση KomoControl</h2>{signedIn ? <><p>{message || "Είσαι συνδεδεμένος."}</p><div className="actions"><button className="primary" onClick={() => void claimFirstAdmin()}>Ορισμός πρώτου admin</button><button onClick={() => void supabase?.auth.signOut().then(() => { setSignedIn(false); setMessage("Έγινε αποσύνδεση."); })}>Αποσύνδεση</button></div></> : <><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Κωδικός<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><div className="actions"><button className="primary" onClick={() => void signIn()}>Σύνδεση</button><button onClick={() => void signIn(true)}>Δημιουργία λογαριασμού</button></div><p className="status">{message}</p></>}</section><section className="panel"><h2>Ρόλοι αγώνα</h2><p>Ο admin αναθέτει στο Supabase viewer, scorer, corrector ή approver ανά αγώνα. Οι κανόνες RLS επιτρέπουν μόνο τις αντίστοιχες ενέργειες.</p></section></main>;
}
