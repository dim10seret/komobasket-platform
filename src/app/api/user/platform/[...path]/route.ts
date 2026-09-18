import { handleOrganizationPlatform } from "@/lib/organization-platform-http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) { return handleOrganizationPlatform(request, (await context.params).path); }
export async function GET(request: Request, context: Context) { return handle(request, context); }
export async function POST(request: Request, context: Context) { return handle(request, context); }
export async function PATCH(request: Request, context: Context) { return handle(request, context); }
export async function DELETE(request: Request, context: Context) { return handle(request, context); }
