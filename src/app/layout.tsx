import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KomoBasket",
  description: "Η επίσημη ιστοσελίδα του KomoBasket",

};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="el">
      <body>{children}</body>
    </html>
  );
}
