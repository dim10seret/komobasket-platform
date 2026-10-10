import { requireAdmin } from "@/lib/admin-auth";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { platformMvpErrorResponse, platformMvpOperation } from "@/services/platform-mvp-operation";

export const dynamic = "force-dynamic";

async function handle(request: Request, method: "GET" | "POST" | "PATCH") {
  const authorization = await requireAdmin(request);
  if (authorization.response) return authorization.response;
  try {
    const origin = new URL(request.url).origin;
    if (request.headers.get("sec-fetch-site") === "cross-site" ||
      (method !== "GET" && request.headers.get("origin") !== origin))
      return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    const body = method === "GET" ? "" : await request.text();
    if (body.length > 131072) return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
    const input: Record<string, unknown> = method === "GET"
      ? Object.fromEntries(new URL(request.url).searchParams.entries())
      : JSON.parse(body) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
    const organizationId = typeof input.organizationId === "string" ? input.organizationId.trim() : "";
    if (!organizationId) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
    const db = (await getKomoBasketCloudflareEnv())?.NEWS_DB;
    if (!db) return Response.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503 });
    const response = await platformMvpOperation(db, authorization.user, organizationId, method, input);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return platformMvpErrorResponse(error) ?? Response.json({ error: "Η ενέργεια MVP δεν ολοκληρώθηκε." }, { status: 400 });
  }
}
export async function GET(request: Request) { return handle(request, "GET"); }
export async function POST(request: Request) { return handle(request, "POST"); }
export async function PATCH(request: Request) { return handle(request, "PATCH"); }
