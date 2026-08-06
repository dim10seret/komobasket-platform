"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M13.5 22v-9h3l.5-3.5h-3.5V7.25c0-1.01.28-1.7 1.75-1.7H17.1V2.42c-.32-.04-1.42-.14-2.7-.14-2.67 0-4.5 1.63-4.5 4.63V9.5H7v3.5h2.9v9h3.6Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" r="1" className="fill-current stroke-none" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M23.5 6.2a3.02 3.02 0 0 0-2.13-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.37.51A3.02 3.02 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.13 2.14c1.87.51 9.37.51 9.37.51s7.5 0 9.37-.51a3.02 3.02 0 0 0 2.13-2.14A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.84 12 9.6 15.6Z" />
    </svg>
  );
}

const navigation = [
  { href: "/", label: "Αρχική" },
  { href: "/schedule", label: "Πρόγραμμα" },
  { href: "/results", label: "Αποτελέσματα" },
  { href: "/standings", label: "Βαθμολογία" },
  { href: "/teams", label: "Ομάδες" },
  { href: "/news", label: "Νέα" },
  { href: "/videos", label: "Βίντεο" },
  { href: "/gallery", label: "Gallery" },
  { href: "/supporters", label: "Υποστηρικτές" },
  { href: "/contact", label: "Επικοινωνία" },
];

const socialLinks = [
  {
    href: "https://www.facebook.com/sbekko.gr/?locale=el_GR",
    label: "Facebook",
    Icon: FacebookIcon,
  },
  {
    href: "https://www.instagram.com/s.b.e.k.ko/",
    label: "Instagram",
    Icon: InstagramIcon,
  },
  {
    href: "https://www.youtube.com/@%CE%A3%CE%A5%CE%9D%CE%94%CE%95%CE%A3%CE%9C%CE%9F%CE%A3%CE%92%CE%95%CE%A4%CE%95%CE%A1%CE%91%CE%9D%CE%A9%CE%9D%CE%9A%CE%91%CE%9B%CE%91%CE%98%CE%9F%CE%A3%CE%A6%CE%91%CE%99%CE%A1%CE%99",
    label: "YouTube",
    Icon: YouTubeIcon,
  },
];

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 shadow-lg">
      <div className="border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <Link href="/" aria-label="KomoBasket - Αρχική" className="flex min-w-0 items-center">
            <Image
              src="/images/komobasket-horizontal-header.png"
              alt="KomoBasket"
              width={1889}
              height={505}
              priority
              className="h-10 w-auto max-w-[150px] object-contain sm:h-12 sm:max-w-[190px] md:h-14 md:max-w-[230px]"
            />
          </Link>

          <div className="flex items-center gap-3 md:gap-5">
            <a
              href="https://sbekko.gr/"
              target="_blank"
              rel="noreferrer"
              aria-label="ΣΒΕΚΚΟ - Επίσημη ιστοσελίδα"
              className="rounded-full transition hover:scale-105"
            >
              <Image
                src="/images/supporters/svekko.png"
                alt="ΣΒΕΚΚΟ"
                width={60}
                height={60}
                className="h-12 w-12 rounded-full object-contain md:h-14 md:w-14"
              />
            </a>

            <button
              type="button"
              className="rounded-lg p-2 text-white transition hover:bg-zinc-800 lg:hidden"
              aria-label={isMenuOpen ? "Κλείσιμο μενού" : "Άνοιγμα μενού"}
              aria-expanded={isMenuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setIsMenuOpen((current) => !current)}
            >
              {isMenuOpen ? <X size={28} /> : <Menu size={28} />}
            </button>
          </div>
        </div>
      </div>

      <nav className="hidden bg-zinc-900 text-white lg:block" aria-label="Κύρια πλοήγηση">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-4 px-6 py-4 text-sm font-semibold xl:gap-6 xl:text-base">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className="whitespace-nowrap transition hover:text-orange-500">
              {item.label}
            </Link>
          ))}

          <div className="ml-1 flex items-center gap-1 border-l border-zinc-700 pl-3" aria-label="Κοινωνικά δίκτυα">
            {socialLinks.map(({ href, label, Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                title={label}
                className="rounded-full p-2 transition hover:bg-zinc-800 hover:text-orange-500"
              >
                <Icon />
              </a>
            ))}
          </div>
        </div>
      </nav>

      {isMenuOpen && (
        <nav id="mobile-navigation" className="bg-zinc-900 px-6 py-5 text-white lg:hidden" aria-label="Πλοήγηση κινητού">
          <div className="mx-auto grid max-w-7xl gap-1">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-4 py-3 font-semibold transition hover:bg-zinc-800 hover:text-orange-500"
                onClick={() => setIsMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}

            <div className="mt-3 flex items-center gap-2 border-t border-zinc-700 px-4 pt-4" aria-label="Κοινωνικά δίκτυα">
              {socialLinks.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  title={label}
                  className="rounded-full bg-zinc-800 p-3 transition hover:bg-orange-500 hover:text-white"
                >
                  <Icon />
                </a>
              ))}
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

