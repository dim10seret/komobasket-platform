import type { Metadata } from "next";
import "./globals.css";

const siteUrl = "https://komobasket.gr";
const siteTitle = "KomoBasket";
const siteDescription =
  "Μια ιδέα που έγινε θεσμός. Η κοινότητα της διά βίου καλαθοσφαίρισης στην Κομοτηνή.";

const socialImage = "/assets/komobasket-og-cover.jpg";
const absoluteSocialImage = `${siteUrl}${socialImage}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),

  title: {
    default: siteTitle,
    template: "%s | KomoBasket",
  },

  description: siteDescription,

  alternates: {
    canonical: "/",
  },

  openGraph: {
    type: "website",
    locale: "el_GR",
    url: siteUrl,
    siteName: siteTitle,
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: socialImage,
        width: 1200,
        height: 630,
        alt: "KomoBasket - Η κοινότητα της διά βίου καλαθοσφαίρισης στην Κομοτηνή",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [socialImage],
  },

  icons: {
    icon: "/icon.png",
  },

  other: {
    "fb:app_id": "1045159868493887",
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SportsOrganization",
  "@id": `${siteUrl}/#organization`,

  name: "KomoBasket",

  url: siteUrl,

  description: siteDescription,

  logo: {
    "@type": "ImageObject",
    url: absoluteSocialImage,
  },

  image: {
    "@type": "ImageObject",
    url: absoluteSocialImage,
    width: 1200,
    height: 630,
  },

  location: {
    "@type": "Place",
    name: "Κομοτηνή",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Κομοτηνή",
      addressCountry: "GR",
    },
  },

  sameAs: [
    "https://www.facebook.com/sbekkokomobasket.gr",
  ],
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${siteUrl}/#website`,

  url: siteUrl,

  name: "KomoBasket",

  description: siteDescription,

  publisher: {
    "@id": `${siteUrl}/#organization`,
  },

  inLanguage: "el-GR",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="el">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd).replace(/</g, "\\u003c"),
          }}
        />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteJsonLd).replace(/</g, "\\u003c"),
          }}
        />

        {children}
      </body>
    </html>
  );
}