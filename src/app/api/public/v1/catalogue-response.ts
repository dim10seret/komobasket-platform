export const CATALOGUE_CACHE = {
  seasons: { "Cache-Control": "public, max-age=300, s-maxage=3600" },
  organizations: { "Cache-Control": "public, max-age=300, s-maxage=1800" },
  competitions: { "Cache-Control": "public, max-age=120, s-maxage=600" },
} as const;

export function requiredCatalogueId(request: Request, name: string): string | null {
  const values = new URL(request.url).searchParams.getAll(name);
  if (values.length !== 1) return null;
  const value = values[0].trim();
  return value.length > 0 && value.length <= 200 ? value : null;
}

export function catalogueError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
