import Link from "next/link";

const finalStandings = [
  { position: 1, team: "ΛΕΚΑΒΕΞ", result: "Πρωταθλήτρια" },
  { position: 2, team: "ΑΠΑΡΑΔΕΚΤΟΙ", result: "Φιναλίστ" },
  { position: 3, team: "PONTIAKOS", result: "Νικητής μικρού τελικού" },
  { position: 4, team: "LOS PROFESORES", result: "4η θέση" },
];

export default function Standings() {
  return <section className="bg-white py-20"><div className="mx-auto max-w-7xl px-6"><div className="mb-10 text-center"><h2 className="text-4xl font-black">Τελική Κατάταξη</h2><p className="mt-3 text-lg text-zinc-500">Final Four KomoBasket League 2025-26</p></div><div className="overflow-hidden rounded-2xl border border-zinc-200 shadow-lg"><table className="w-full"><thead className="bg-zinc-900 text-white"><tr><th className="px-4 py-4 text-left">#</th><th className="px-4 py-4 text-left">Ομάδα</th><th className="px-4 py-4 text-left">Διάκριση</th></tr></thead><tbody>{finalStandings.map(team=><tr key={team.position} className="border-b border-zinc-200"><td className="px-4 py-4 font-black">{team.position}</td><td className="px-4 py-4 font-bold">{team.team}</td><td className="px-4 py-4 text-zinc-600">{team.result}</td></tr>)}</tbody></table></div><div className="mt-8 text-center"><Link href="/standings" className="inline-flex rounded-xl bg-orange-600 px-6 py-3 font-bold text-white">Βαθμολογία κανονικής περιόδου</Link></div></div></section>;
}
