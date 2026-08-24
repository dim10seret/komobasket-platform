"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Option = { id: string; label: string; href: string };

export default function PublicCompactSelector({ label, value, options }: { label: string; value: string; options: Option[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, []);
  return <div ref={rootRef} className="relative"><p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{label}</p><button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-sm font-black text-zinc-950"><span className="truncate">{value}</span><span aria-hidden="true" className="text-orange-700">⌄</span></button>{open && <div className="absolute left-0 z-20 mt-2 max-h-64 min-w-full overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl">{options.map((option) => <Link key={option.id} href={option.href} onClick={() => setOpen(false)} className={`block rounded-xl px-3 py-2 text-sm font-bold hover:bg-orange-50 ${option.label === value ? "bg-zinc-950 text-white hover:bg-zinc-950" : "text-zinc-700"}`}>{option.label}</Link>)}</div>}</div>;
}
