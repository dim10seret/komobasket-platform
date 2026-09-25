"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { hostedOrganizationPath } from "@/lib/hosted-organization-routes";
import type { HostedPublicOrganization } from "@/services/hosted-public-organization.service";

const navigation = [
  ["home", "Αρχική"],
  ["competitions", "Διοργανώσεις"],
  ["statistics", "Στατιστικά & MVP"],
  ["supporters", "Υποστηρικτές"],
  ["contact", "Επικοινωνία"],
] as const;

function OrganizationIdentity({ organization }: { organization: HostedPublicOrganization }) {
  return <Link href={hostedOrganizationPath(organization.slug)} className="flex min-w-0 flex-1 items-center gap-3" aria-label={`${organization.name} - Αρχική`}>
    {organization.canonicalLogoUrl ? <img src={organization.canonicalLogoUrl} alt="" className="size-12 shrink-0 rounded-xl bg-white object-contain p-1" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-xl font-black text-white">{organization.name.slice(0, 1).toUpperCase()}</span>}
    <span className="truncate text-xl font-black text-white sm:text-2xl">{organization.name}</span>
  </Link>;
}

function PublicHeaderLogo({ organization }: { organization: HostedPublicOrganization }) {
  if (!organization.publicHeaderLogoUrl) return null;
  const logo = <img src={organization.publicHeaderLogoUrl} alt="" className="h-10 w-auto max-w-20 object-contain sm:h-14 sm:max-w-40" />;
  return organization.publicHeaderLinkUrl ? <a href={organization.publicHeaderLinkUrl} target="_blank" rel="noopener noreferrer" aria-label={`Εξωτερικός σύνδεσμος ${organization.name}`} className="rounded-xl transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400">{logo}</a> : logo;
}

export default function HostedOrganizationHeader({ organization }: { organization: HostedPublicOrganization }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return <header className="border-b border-zinc-800 bg-zinc-950 text-white shadow-lg">
    <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-3 px-5 py-3 sm:gap-5 sm:px-7">
      <OrganizationIdentity organization={organization} />
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <PublicHeaderLogo organization={organization} />
        <button
          type="button"
          className="rounded-lg p-2 text-white transition hover:bg-zinc-800 lg:hidden"
          aria-label={isMenuOpen ? "Κλείσιμο μενού" : "Άνοιγμα μενού"}
          aria-expanded={isMenuOpen}
          aria-controls="hosted-mobile-navigation"
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          {isMenuOpen ? <X size={28} /> : <Menu size={28} />}
        </button>
      </div>
    </div>
    <nav aria-label={`Πλοήγηση ${organization.name}`} className="hidden border-t border-zinc-800 bg-zinc-900 lg:block">
      <div className="mx-auto flex max-w-7xl flex-wrap justify-center gap-2 px-7 py-3">
        {navigation.map(([route, label]) => <Link key={route} href={hostedOrganizationPath(organization.slug, route)} className="rounded-lg px-3 py-2 text-sm font-bold text-zinc-100 transition hover:bg-zinc-800 hover:text-orange-400 focus-visible:outline-2 focus-visible:outline-orange-400">{label}</Link>)}
      </div>
    </nav>
    {isMenuOpen ? (
      <nav id="hosted-mobile-navigation" aria-label={`Πλοήγηση κινητού ${organization.name}`} className="border-t border-zinc-800 bg-zinc-900 px-5 py-4 lg:hidden">
        <div className="mx-auto grid max-w-7xl gap-1">
          {navigation.map(([route, label]) => (
            <Link
              key={route}
              href={hostedOrganizationPath(organization.slug, route)}
              className="rounded-lg border-l-4 border-transparent px-4 py-3 font-bold text-zinc-100 transition hover:border-orange-500 hover:bg-zinc-800 hover:text-orange-400 focus-visible:outline-2 focus-visible:outline-orange-400"
              onClick={() => setIsMenuOpen(false)}
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>
    ) : null}
  </header>;
}
