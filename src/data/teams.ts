import { Team } from "@/types/team";

const teamNames2019 = [
  ["ihodromio", "ΗΧΟΔΡΟΜΙΟ", "ihodromio.png"], ["astynomia-rodopis", "ΑΣΤΥΝΟΜΙΑ ΡΟΔΟΠΗΣ", "astynomia-rodopis.png"], ["metalla-teleia-kom", "ΜΕΤΑΛΛΑ ΤΕΛΕΙΑ ΚΟΜ", "metalla-teleia-kom.png"], ["giafka-bc", "ΓΙΑΦΚΑ BC", "giafka-bc.png"], ["sidream-team", "ΣΙDREAM TEAM", "sidream-team.png"], ["elafia-komotinis", "ΕΛΑΦΙΑ ΚΟΜΟΤΗΝΗΣ", "elafia-komotinis.png"], ["farmers", "FARMERS", "farmers.jpg"], ["100kg-plus", "100KG+", "100kg-plus.png"], ["ittah-jazz", "ITTAH JAZZ", "ittah-jazz.png"], ["hunters", "HUNTERS", "hunters.png"], ["gas-palaimaxoi", "ΓΑΣ ΠΑΛΑΙΜΑΧΟΙ", "gas-palaimaxoi.png"], ["palaimaxoi-ethnikou-alexandroupolis", "ΠΑΛΑΙΜΑΧΟΙ ΕΘΝΙΚΟΥ ΑΛΕΞΑΝΔΡΟΥΠΟΛΗΣ", "palaimaxoi-ethnikou-alexandroupolis.png"], ["autonetparts", "AutoNetParts", "autonetparts.png"], ["the-daltons", "THE DALTONS", "the-daltons.png"], ["pharmathen", "PHARMATHEN", "pharmathen.png"], ["netmen", "NETMEN", "netmen.png"],
] as const;

const teamNames2021 = [
  ["metalla-teleia-kom", "ΜΕΤΑΛΛΑ ΤΕΛΕΙΑ ΚΟΜ", "metalla-teleia-kom.png"], ["netmen", "NETMEN", "netmen.png"], ["elafia-komotinis", "ΕΛΑΦΙΑ ΚΟΜΟΤΗΝΗΣ", "elafia-komotinis.png"], ["gas-palaimaxoi", "ΓΑΣ ΠΑΛΑΙΜΑΧΟΙ", "gas-palaimaxoi.png"], ["sidream-team", "ΣΙDREAM TEAM", "sidream-team.png"], ["100kg-plus", "100KG+", "100kg-plus.png"], ["farmers", "FARMERS", "farmers.png"], ["astynomia-rodopis", "ΑΣΤΥΝΟΜΙΑ ΡΟΔΟΠΗΣ", "astynomia-rodopis.png"], ["giafka-bc", "ΓΙΑΦΚΑ BC", "giafka-bc.png"], ["ittah-jazz", "ΙΤΤΑΗ JAZZ", "ittah-jazz.png"],
] as const;

const teamNames2022 = [
  ["hunters", "HUNTERS", "hunters.png"], ["pharmathen", "PHARMATHEN", "pharmathen.png"], ["syfa-rodopis", "ΣΥ.ΦΑ. ΡΟΔΟΠΗΣ", "syfa-rodopis.jpeg"], ["metalla-teleia-kom", "ΜΕΤΑΛΛΑ ΤΕΛΕΙΑ ΚΟΜ", "metalla-teleia-kom.png"], ["netmen", "NETMEN", "netmen.png"], ["50-plus", "50+", "50-plus.png"], ["sidream-team", "ΣΙDREAM TEAM", "sidream-team.png"], ["aparadektoi", "ΑΠΑΡΑΔΕΚΤΟΙ", "aparadektoi.png"], ["palaimaxoi-aias", "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", "palaimaxoi-aias.jpg"], ["astynomia-rodopis", "ΑΣΤΥΝΟΜΙΑ ΡΟΔΟΠΗΣ", "astynomia-rodopis.png"], ["giafka-bc", "ΓΙΑΦΚΑ BC", "giafka-bc.png"],
] as const;

const teamNames2023 = [
  ["jugopiastika", "JUGOPIASTIKA", "jugopiastika.png"], ["pharmathen", "PHARMATHEN", "pharmathen.png"], ["orlando-tragic", "ORLANDO TRAGIC", "orlando-tragic.jpeg"], ["pontiakos-bc", "PONTIAKOS B.C.", "pontiakos-bc.jpeg"], ["netmen", "NETMEN", "netmen.png"], ["los-bandoleros", "LOS BANDOLEROS", "los-bandoleros.png"], ["sidream-team", "ΣΙDREAM TEAM", "sidream-team.png"], ["aparadektoi", "ΑΠΑΡΑΔΕΚΤΟΙ", "aparadektoi.png"], ["palaimaxoi-aias", "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", "palaimaxoi-aias.jpg"], ["gioucha-jazz", "ΓΙΟΥΧΑ JAZZ", "gioucha-jazz.jpeg"], ["lekavex", "ΛΕΚΑΒΕΞ", "lekavex.jpg"], ["efepae", "ΕΦΕΠΑΕ", "efepae.jpeg"], ["sapes-bc", "ΣΑΠΕΣ B.C.", "sapes-bc.jpeg"], ["souvlakers", "ΣΟΥΒLAKERS", "souvlakers.jpeg"],
] as const;

const teamNames2024 = [
  ["chicken-nuggets", "CHICKEN NUGGETS", "chicken-nuggets.jpg"], ["customs-bc", "CUSTOMS BC", "customs-bc.jpg"], ["jugopiastika", "JUGOPIASTIKA", "jugopiastika.png"], ["komoti-knicks", "KOMOTI- KNICKS", "komoti-knicks.png"], ["los-badoleros", "LOS BADOLEROS", "los-bandoleros.jpg"], ["netmen", "NETMEN", "netmen.jpg"], ["pharmathen", "PHARMATHEN", "pharmathen.jpg"], ["pontiakos", "PONTIAKOS", "pontiakos.jpg"], ["rodopi-rockets", "RODOPI ROCKETS", "rodopi-rockets.jpg"], ["sapes-bc", "SAPES BC", "sapes-bc.jpg"], ["aparadektoi", "ΑΠΑΡΑΔΕΚΤΟΙ", "aparadektoi.jpg"], ["gioucha-jazz", "ΓΙΟΥΧΑ JAZZ", "gioucha-jazz.jpg"], ["lekavex", "ΛΕΚΑΒΕΞ", "lekavex.jpg"], ["palaimachoi-aias", "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", "palaimachoi-aias.jpg"], ["sidream-team", "ΣΙDREAM TEAM", "sidream-team.jpg"], ["souvlakers", "ΣΟΥΒLAKERS", "souvlakers.jpg"],
] as const;

const teamNames2025 = [
  ["side-effects", "SIDE EFFECTS", "side-effects.jpg"], ["palaimachoi-aias", "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", "palaimaxoi-aias.jpg"], ["gioucha-jazz", "ΓΙΟΥΧΑ JAZZ", "gioucha-jazz.jpg"], ["netmen", "NETMEN", "netmen.jpg"], ["jugopiastika", "JUGOPIASTIKA", "jugopiastika.png"], ["lekavex", "ΛΕΚΑΒΕΞ", "lekavex.jpg"], ["sidream-team", "ΣΙDREAM TEAM", "sidream-team.jpg"], ["customs-bc", "CUSTOMS BC", "customs-bc.jpg"], ["pontiakos", "PONTIAKOS", "pontiakos.jpg"], ["souvlakers", "ΣΟΥΒLAKERS", "souvlakers.jpg"], ["rodopi-rockets", "RODOPI ROCKETS", "rodopi-rockets.jpg"], ["beerwaukee-mpakes", "BEERWAUKEE ΜΠΑΚΕΣ", "beerwaukee-mpakes.jpg"], ["chicken-nuggets", "CHICKEN NUGGETS", "chicken-nuggets.jpg"], ["los-badoleros", "LOS BADOLEROS", "los-badoleros.jpg"], ["aparadektoi", "ΑΠΑΡΑΔΕΚΤΟΙ", "aparadektoi.jpg"], ["los-profesores", "LOS PROFESORES", "los-profesores.jpg"],
] as const;

function makeTeams(season: string, rows: readonly (readonly [string, string, string])[]): Team[] {
  return rows.map(([baseSlug, name, logo], index) => ({ id: index + 1, slug: `${season}-${baseSlug}`, name, season, logo: `/logos/teams/${season}/${logo}`, primaryColor: "#18181b", secondaryColor: "#f97316", city: "Κομοτηνή" }));
}

export const teams: Team[] = [...makeTeams("2019-20", teamNames2019), ...makeTeams("2021-22", teamNames2021), ...makeTeams("2022-23", teamNames2022), ...makeTeams("2023-24", teamNames2023), ...makeTeams("2024-25", teamNames2024), ...makeTeams("2025-26", teamNames2025)];
