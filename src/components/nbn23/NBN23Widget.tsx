"use client";

import { useEffect } from "react";
import Script from "next/script";

declare global {
  interface Window {
    swish_widget_app?: {
      init: (config: {
        mountOn: string;
        apiKey?: string;
        theme?: string;
      }) => void;
    };
  }
}

export default function NBN23Widget() {
  useEffect(() => {
    if (!window.swish_widget_app) return;

    window.swish_widget_app.init({
      mountOn: "nbn23-widget",
      apiKey: process.env.NEXT_PUBLIC_NBN23_API_KEY,
      theme: process.env.NEXT_PUBLIC_NBN23_THEME,
    });
  }, []);

  return (
    <>
      <Script
        src="https://widget.nbn23.com/widget-react.js.gz"
        strategy="afterInteractive"
        onLoad={() => {
          window.swish_widget_app?.init({
            mountOn: "nbn23-widget",
            apiKey: process.env.NEXT_PUBLIC_NBN23_API_KEY,
            theme: process.env.NEXT_PUBLIC_NBN23_THEME,
          });
        }}
      />

      <div
        id="nbn23-widget"
        style={{
          minHeight: "900px",
          width: "100%",
        }}
      />
    </>
  );
}
