import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Είσοδος Χρήστη | KomoBasket Platform",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.png" },
};

export default function OrganizationUserLayout({ children }: { children: React.ReactNode }) {
  return <html lang="el"><body>{children}</body></html>;
}
