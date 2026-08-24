"use client";

import { useState } from "react";

import type { PublicVenue } from "@/services/public-competition.service";

export default function VenueDetails({ venue }: { venue: PublicVenue }) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(venue.address || venue.mapUrl);
  if (!hasDetails) return <span>📍 {venue.name}</span>;
  return <><button type="button" onClick={() => setOpen(true)} className="rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-700 hover:bg-orange-100 hover:text-orange-800">📍 {venue.name}</button>{open && <div role="dialog" aria-modal="true" aria-labelledby="venue-dialog-title" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4" onClick={() => setOpen(false)}><section className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Χώρος αγώνα</p><h3 id="venue-dialog-title" className="mt-1 text-xl font-black text-zinc-950">{venue.name}</h3></div><button type="button" onClick={() => setOpen(false)} aria-label="Κλείσιμο" className="rounded-full bg-zinc-100 px-3 py-1.5 font-black text-zinc-700">×</button></div>{venue.address && <p className="mt-4 text-sm leading-6 text-zinc-700">{venue.address}</p>}{venue.mapUrl && <a href={venue.mapUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-black text-white hover:bg-zinc-800">Άνοιγμα στον χάρτη</a>}</section></div>}</>;
}
