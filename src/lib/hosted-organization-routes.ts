export type HostedOrganizationRoute =
  | "home"
  | "competitions"
  | "statistics"
  | "supporters"
  | "contact";

const routeSuffixes: Record<HostedOrganizationRoute, string> = {
  home: "",
  competitions: "/competitions",
  statistics: "/statistics",
  supporters: "/supporters",
  contact: "/contact",
};

export function hostedOrganizationPath(
  slug: string,
  route: HostedOrganizationRoute = "home",
) {
  return `/${encodeURIComponent(slug)}${routeSuffixes[route]}`;
}

export function hostedCompetitionGamePath(slug: string, gameId: string, live = false) {
  return `${hostedOrganizationPath(slug, "competitions")}/games/${encodeURIComponent(gameId)}${live ? "/live" : ""}`;
}

export function hostedLiveApiPath(slug: string, gameId: string) {
  return `/api/public/v1/organizations/${encodeURIComponent(slug)}/games/${encodeURIComponent(gameId)}/live`;
}
