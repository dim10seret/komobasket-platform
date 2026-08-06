import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;

initOpenNextCloudflareForDev();
