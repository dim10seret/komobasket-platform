import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KomoBasketCloudflareEnv } from "@/types/cloudflare";

export async function getKomoBasketCloudflareEnv() {
  try {
    const context = await getCloudflareContext({ async: true });
    return context.env as KomoBasketCloudflareEnv;
  } catch {
    return null;
  }
}
