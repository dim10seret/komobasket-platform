export type Team = {
  id: number;
  slug: string;
  name: string;
  shortName: string;
  logo: string;
  wins: number;
  losses: number;
  games: number;
  position: number;
  pointsDiff: number;
};

export const teams: Team[] = [
  {
    id: 1,
    slug: "beerwaukee",
    name: "Beerwaukee",
    shortName: "Beerwaukee",
    logo: "/logos/teams/beerwaukee.png",
    wins: 14,
    losses: 1,
    games: 15,
    position: 1,
    pointsDiff: 185,
  },
  {
    id: 2,
    slug: "pontiakos-bc",
    name: "Pontiakos BC",
    shortName: "Pontiakos",
    logo: "/logos/teams/pontiakos-bc.png",
    wins: 13,
    losses: 2,
    games: 15,
    position: 2,
    pointsDiff: 152,
  },
  {
    id: 3,
    slug: "los-profesores",
    name: "Los Profesores",
    shortName: "Profesores",
    logo: "/logos/teams/los-profesores.png",
    wins: 12,
    losses: 3,
    games: 15,
    position: 3,
    pointsDiff: 121,
  },
  {
    id: 4,
    slug: "side-effects",
    name: "Side Effects",
    shortName: "Side Effects",
    logo: "/logos/teams/side-effects.png",
    wins: 11,
    losses: 4,
    games: 15,
    position: 4,
    pointsDiff: 88,
  },
  {
    id: 5,
    slug: "rodopi-rockets",
    name: "Rodopi Rockets",
    shortName: "Rockets",
    logo: "/logos/teams/rodopi-rockets.png",
    wins: 9,
    losses: 6,
    games: 15,
    position: 5,
    pointsDiff: 42,
  },
  {
    id: 6,
    slug: "customs-bc",
    name: "Customs BC",
    shortName: "Customs",
    logo: "/logos/teams/customs-bc.png",
    wins: 8,
    losses: 7,
    games: 15,
    position: 6,
    pointsDiff: 11,
  },
  {
    id: 7,
    slug: "lekavex",
    name: "ΛΕΚΑΒΕΞ",
    shortName: "ΛΕΚΑΒΕΞ",
    logo: "/logos/teams/lekavex.png",
    wins: 7,
    losses: 8,
    games: 15,
    position: 7,
    pointsDiff: -12,
  },
  {
    id: 8,
    slug: "aparadektoi",
    name: "Απαράδεκτοι",
    shortName: "Απαράδεκτοι",
    logo: "/logos/teams/aparadektoi.png",
    wins: 6,
    losses: 9,
    games: 15,
    position: 8,
    pointsDiff: -27,
  },
];