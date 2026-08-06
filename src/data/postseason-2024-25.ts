export type KnockoutGame = {
  id: string;
  stage: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  note?: string;
};

export type PlayoffSeries = {
  id: string;
  stage: "Play out 5-12" | "Φάση των 8";
  teamA: string;
  teamB: string;
  winner: string;
  games: { label: string; homeTeam: string; awayTeam: string; homeScore?: number; awayScore?: number }[];
};

export const playoffSeries: PlayoffSeries[] = [
  { id: "series-1", stage: "Play out 5-12", teamA: "LOS BADOLEROS", teamB: "CHICKEN NUGGETS", winner: "LOS BADOLEROS", games: [
    { label: "Κανονική περίοδος · προσμετρήθηκε", homeTeam: "CHICKEN NUGGETS", awayTeam: "LOS BADOLEROS", homeScore: 51, awayScore: 69 },
    { label: "Play out", homeTeam: "LOS BADOLEROS", awayTeam: "CHICKEN NUGGETS", homeScore: 59, awayScore: 45 },
  ] },
  { id: "series-2", stage: "Play out 5-12", teamA: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", teamB: "KOMOTI- KNICKS", winner: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", games: [
    { label: "Κανονική περίοδος · προσμετρήθηκε", homeTeam: "KOMOTI- KNICKS", awayTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", homeScore: 53, awayScore: 66 },
    { label: "Play out", homeTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", awayTeam: "KOMOTI- KNICKS", homeScore: 56, awayScore: 66 },
    { label: "Play out", homeTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", awayTeam: "KOMOTI- KNICKS", homeScore: 67, awayScore: 50 },
  ] },
  { id: "series-3", stage: "Play out 5-12", teamA: "JUGOPIASTIKA", teamB: "NETMEN", winner: "JUGOPIASTIKA", games: [
    { label: "Κανονική περίοδος · προσμετρήθηκε", homeTeam: "JUGOPIASTIKA", awayTeam: "NETMEN", homeScore: 52, awayScore: 46 },
    { label: "Play out", homeTeam: "JUGOPIASTIKA", awayTeam: "NETMEN", homeScore: 55, awayScore: 42 },
  ] },
  { id: "series-4", stage: "Play out 5-12", teamA: "ΣΙDREAM TEAM", teamB: "ΣΟΥΒLAKERS", winner: "ΣΙDREAM TEAM", games: [
    { label: "Κανονική περίοδος · προσμετρήθηκε", homeTeam: "ΣΟΥΒLAKERS", awayTeam: "ΣΙDREAM TEAM", homeScore: 29, awayScore: 55 },
    { label: "Play out · σκορ μη διαθέσιμο", homeTeam: "ΣΙDREAM TEAM", awayTeam: "ΣΟΥΒLAKERS" },
  ] },
  { id: "series-5", stage: "Φάση των 8", teamA: "ΑΠΑΡΑΔΕΚΤΟΙ", teamB: "LOS BADOLEROS", winner: "ΑΠΑΡΑΔΕΚΤΟΙ", games: [
    { label: "Κανονική περίοδος · προσμετρήθηκε", homeTeam: "LOS BADOLEROS", awayTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", homeScore: 61, awayScore: 77 },
    { label: "Playoffs", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "LOS BADOLEROS", homeScore: 91, awayScore: 44 },
  ] },
  { id: "series-6", stage: "Φάση των 8", teamA: "PONTIAKOS", teamB: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", winner: "PONTIAKOS", games: [
    { label: "Κανονική περίοδος · προσμετρήθηκε", homeTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", awayTeam: "PONTIAKOS", homeScore: 44, awayScore: 70 },
    { label: "Playoffs", homeTeam: "PONTIAKOS", awayTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", homeScore: 105, awayScore: 103 },
  ] },
  { id: "series-7", stage: "Φάση των 8", teamA: "ΛΕΚΑΒΕΞ", teamB: "JUGOPIASTIKA", winner: "ΛΕΚΑΒΕΞ", games: [
    { label: "Κανονική περίοδος · προσμετρήθηκε", homeTeam: "JUGOPIASTIKA", awayTeam: "ΛΕΚΑΒΕΞ", homeScore: 57, awayScore: 66 },
    { label: "Playoffs", homeTeam: "ΛΕΚΑΒΕΞ", awayTeam: "JUGOPIASTIKA", homeScore: 80, awayScore: 46 },
  ] },
  { id: "series-8", stage: "Φάση των 8", teamA: "SAPES BC", teamB: "ΣΙDREAM TEAM", winner: "ΣΙDREAM TEAM", games: [
    { label: "Κανονική περίοδος · προσμετρήθηκε", homeTeam: "SAPES BC", awayTeam: "ΣΙDREAM TEAM", homeScore: 47, awayScore: 45 },
    { label: "Playoffs · σκορ μη διαθέσιμο", homeTeam: "SAPES BC", awayTeam: "ΣΙDREAM TEAM" },
  ] },
];

export const playoffGames: KnockoutGame[] = [
  { id: "po-1", stage: "Play-in", homeTeam: "LOS BADOLEROS", awayTeam: "CHICKEN NUGGETS", homeScore: 59, awayScore: 45, note: "Πρόκριση LOS BADOLEROS με 2-0 (προσμετρήθηκε το 69-51 της κανονικής περιόδου)." },
  { id: "po-2", stage: "Play-in", homeTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", awayTeam: "KOMOTI- KNICKS", homeScore: 56, awayScore: 66, note: "Η σειρά κρίθηκε 2-1 υπέρ των ΠΑΛΑΙΜΑΧΩΝ ΑΙΑΣ. Επιπλέον αγώνας: 67-50." },
  { id: "po-3", stage: "Play-in", homeTeam: "JUGOPIASTIKA", awayTeam: "NETMEN", homeScore: 55, awayScore: 42, note: "Πρόκριση JUGOPIASTIKA με 2-0 (προσμετρήθηκε το 52-46 της κανονικής περιόδου)." },
  { id: "po-4", stage: "Play-in", homeTeam: "ΣΙDREAM TEAM", awayTeam: "ΣΟΥΒLAKERS", note: "Πρόκριση ΣΙDREAM TEAM. Το πλήρες σκορ δεν φαίνεται στο διαθέσιμο στιγμιότυπο." },
  { id: "po-5", stage: "Προημιτελικά", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "LOS BADOLEROS", homeScore: 91, awayScore: 44, note: "Πρόκριση ΑΠΑΡΑΔΕΚΤΟΙ με 2-0." },
  { id: "po-6", stage: "Προημιτελικά", homeTeam: "PONTIAKOS", awayTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", homeScore: 105, awayScore: 103, note: "Πρόκριση PONTIAKOS με 2-0." },
  { id: "po-7", stage: "Προημιτελικά", homeTeam: "ΛΕΚΑΒΕΞ", awayTeam: "JUGOPIASTIKA", homeScore: 80, awayScore: 46, note: "Πρόκριση ΛΕΚΑΒΕΞ με 2-0." },
  { id: "po-8", stage: "Προημιτελικά", homeTeam: "SAPES BC", awayTeam: "ΣΙDREAM TEAM", note: "Πρόκριση ΣΙDREAM TEAM. Το πλήρες σκορ δεν φαίνεται στο διαθέσιμο στιγμιότυπο." },
  { id: "po-9", stage: "Final Four · Ημιτελικός", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "PONTIAKOS", homeScore: 73, awayScore: 55 },
  { id: "po-10", stage: "Final Four · Ημιτελικός", homeTeam: "ΛΕΚΑΒΕΞ", awayTeam: "ΣΙDREAM TEAM", homeScore: 71, awayScore: 57 },
  { id: "po-11", stage: "Final Four · Τελικός", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "ΛΕΚΑΒΕΞ", homeScore: 56, awayScore: 64, note: "Πρωταθλήτρια 2024-25: ΛΕΚΑΒΕΞ" },
];

export const cupGames: KnockoutGame[] = [
  { id: "cup-1", stage: "Φάση των 16", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "CHICKEN NUGGETS", homeScore: 61, awayScore: 52 },
  { id: "cup-2", stage: "Φάση των 16", homeTeam: "CUSTOMS BC", awayTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", homeScore: 42, awayScore: 44 },
  { id: "cup-3", stage: "Φάση των 16", homeTeam: "KOMOTI- KNICKS", awayTeam: "ΣΟΥΒLAKERS", homeScore: 58, awayScore: 52 },
  { id: "cup-4", stage: "Φάση των 16", homeTeam: "JUGOPIASTIKA", awayTeam: "NETMEN", homeScore: 45, awayScore: 51 },
  { id: "cup-5", stage: "Φάση των 16", homeTeam: "ΣΙDREAM TEAM", awayTeam: "ΛΕΚΑΒΕΞ", homeScore: 57, awayScore: 71 },
  { id: "cup-6", stage: "Φάση των 16", homeTeam: "PHARMATHEN", awayTeam: "SAPES BC", homeScore: 41, awayScore: 71 },
  { id: "cup-7", stage: "Φάση των 16", homeTeam: "LOS BADOLEROS", awayTeam: "RODOPI ROCKETS", homeScore: 68, awayScore: 36 },
  { id: "cup-8", stage: "Φάση των 16", homeTeam: "ΓΙΟΥΧΑ JAZZ", awayTeam: "PONTIAKOS", homeScore: 54, awayScore: 61 },
  { id: "cup-9", stage: "Προημιτελικά", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", homeScore: 63, awayScore: 74 },
  { id: "cup-10", stage: "Προημιτελικά", homeTeam: "KOMOTI- KNICKS", awayTeam: "NETMEN", homeScore: 67, awayScore: 28 },
  { id: "cup-11", stage: "Προημιτελικά", homeTeam: "ΛΕΚΑΒΕΞ", awayTeam: "SAPES BC", homeScore: 67, awayScore: 47 },
  { id: "cup-12", stage: "Προημιτελικά", homeTeam: "LOS BADOLEROS", awayTeam: "PONTIAKOS", homeScore: 71, awayScore: 79 },
  { id: "cup-13", stage: "Ημιτελικά", homeTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", awayTeam: "KOMOTI- KNICKS", homeScore: 75, awayScore: 60 },
  { id: "cup-14", stage: "Ημιτελικά", homeTeam: "ΛΕΚΑΒΕΞ", awayTeam: "PONTIAKOS", homeScore: 63, awayScore: 45 },
  { id: "cup-15", stage: "Τελικός", homeTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", awayTeam: "ΛΕΚΑΒΕΞ", homeScore: 74, awayScore: 64, note: "Κυπελλούχος 2024-25: ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ" },
];
