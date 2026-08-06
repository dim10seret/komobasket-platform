export type PostseasonGame2025 = {
  id: string;
  stage: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  label?: string;
  note?: string;
};

export type PlayoffSeries2025 = {
  id: string;
  stage: "Play out 5-12" | "Φάση των 8";
  teamA: string;
  teamB: string;
  winner: string;
  games: PostseasonGame2025[];
};

export const playoffSeries2025: PlayoffSeries2025[] = [
  { id: "25-series-1", stage: "Play out 5-12", teamA: "CUSTOMS BC", teamB: "ΓΙΟΥΧΑ JAZZ", winner: "CUSTOMS BC", games: [
    { id: "25-po-1a", stage: "Play out 5-12", homeTeam: "CUSTOMS BC", awayTeam: "ΓΙΟΥΧΑ JAZZ", homeScore: 68, awayScore: 48, label: "1ος αγώνας" },
    { id: "25-po-1b", stage: "Play out 5-12", homeTeam: "CUSTOMS BC", awayTeam: "ΓΙΟΥΧΑ JAZZ", homeScore: 51, awayScore: 42, label: "2ος αγώνας" },
  ] },
  { id: "25-series-2", stage: "Play out 5-12", teamA: "BEERWAUKEE ΜΠΑΚΕΣ", teamB: "SIDE EFFECTS", winner: "BEERWAUKEE ΜΠΑΚΕΣ", games: [
    { id: "25-po-2a", stage: "Play out 5-12", homeTeam: "SIDE EFFECTS", awayTeam: "BEERWAUKEE ΜΠΑΚΕΣ", homeScore: 41, awayScore: 68, label: "Κανονική περίοδος · προσμετρήθηκε" },
    { id: "25-po-2b", stage: "Play out 5-12", homeTeam: "BEERWAUKEE ΜΠΑΚΕΣ", awayTeam: "SIDE EFFECTS", homeScore: 56, awayScore: 44, label: "Play out" },
  ] },
  { id: "25-series-3", stage: "Play out 5-12", teamA: "ΣΙDREAM TEAM", teamB: "JUGOPIASTIKA", winner: "ΣΙDREAM TEAM", games: [
    { id: "25-po-3a", stage: "Play out 5-12", homeTeam: "ΣΙDREAM TEAM", awayTeam: "JUGOPIASTIKA", homeScore: 70, awayScore: 61, label: "Κανονική περίοδος · προσμετρήθηκε" },
    { id: "25-po-3b", stage: "Play out 5-12", homeTeam: "ΣΙDREAM TEAM", awayTeam: "JUGOPIASTIKA", homeScore: 48, awayScore: 52, label: "Play out" },
    { id: "25-po-3c", stage: "Play out 5-12", homeTeam: "ΣΙDREAM TEAM", awayTeam: "JUGOPIASTIKA", homeScore: 64, awayScore: 31, label: "Play out" },
  ] },
  { id: "25-series-4", stage: "Play out 5-12", teamA: "LOS BADOLEROS", teamB: "CHICKEN NUGGETS", winner: "LOS BADOLEROS", games: [
    { id: "25-po-4a", stage: "Play out 5-12", homeTeam: "CHICKEN NUGGETS", awayTeam: "LOS BADOLEROS", homeScore: 47, awayScore: 68, label: "Κανονική περίοδος · προσμετρήθηκε" },
    { id: "25-po-4b", stage: "Play out 5-12", homeTeam: "LOS BADOLEROS", awayTeam: "CHICKEN NUGGETS", homeScore: 64, awayScore: 55, label: "Play out" },
  ] },
  { id: "25-series-5", stage: "Φάση των 8", teamA: "ΛΕΚΑΒΕΞ", teamB: "CUSTOMS BC", winner: "ΛΕΚΑΒΕΞ", games: [
    { id: "25-qf-1a", stage: "Φάση των 8", homeTeam: "ΛΕΚΑΒΕΞ", awayTeam: "CUSTOMS BC", homeScore: 59, awayScore: 50, label: "Κανονική περίοδος · προσμετρήθηκε" },
    { id: "25-qf-1b", stage: "Φάση των 8", homeTeam: "ΛΕΚΑΒΕΞ", awayTeam: "CUSTOMS BC", homeScore: 72, awayScore: 69, label: "Playoffs" },
  ] },
  { id: "25-series-6", stage: "Φάση των 8", teamA: "LOS PROFESORES", teamB: "BEERWAUKEE ΜΠΑΚΕΣ", winner: "LOS PROFESORES", games: [
    { id: "25-qf-2a", stage: "Φάση των 8", homeTeam: "BEERWAUKEE ΜΠΑΚΕΣ", awayTeam: "LOS PROFESORES", homeScore: 49, awayScore: 60, label: "Κανονική περίοδος · προσμετρήθηκε" },
    { id: "25-qf-2b", stage: "Φάση των 8", homeTeam: "LOS PROFESORES", awayTeam: "BEERWAUKEE ΜΠΑΚΕΣ", homeScore: 64, awayScore: 71, label: "Playoffs" },
    { id: "25-qf-2c", stage: "Φάση των 8", homeTeam: "LOS PROFESORES", awayTeam: "BEERWAUKEE ΜΠΑΚΕΣ", homeScore: 73, awayScore: 66, label: "Playoffs" },
  ] },
  { id: "25-series-7", stage: "Φάση των 8", teamA: "PONTIAKOS", teamB: "ΣΙDREAM TEAM", winner: "PONTIAKOS", games: [
    { id: "25-qf-3a", stage: "Φάση των 8", homeTeam: "ΣΙDREAM TEAM", awayTeam: "PONTIAKOS", homeScore: 50, awayScore: 70, label: "Κανονική περίοδος · προσμετρήθηκε" },
    { id: "25-qf-3b", stage: "Φάση των 8", homeTeam: "PONTIAKOS", awayTeam: "ΣΙDREAM TEAM", homeScore: 60, awayScore: 64, label: "Playoffs" },
    { id: "25-qf-3c", stage: "Φάση των 8", homeTeam: "PONTIAKOS", awayTeam: "ΣΙDREAM TEAM", homeScore: 73, awayScore: 50, label: "Playoffs" },
  ] },
  { id: "25-series-8", stage: "Φάση των 8", teamA: "ΑΠΑΡΑΔΕΚΤΟΙ", teamB: "LOS BADOLEROS", winner: "ΑΠΑΡΑΔΕΚΤΟΙ", games: [
    { id: "25-qf-4a", stage: "Φάση των 8", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "LOS BADOLEROS", homeScore: 57, awayScore: 54, label: "Κανονική περίοδος · προσμετρήθηκε" },
    { id: "25-qf-4b", stage: "Φάση των 8", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "LOS BADOLEROS", homeScore: 70, awayScore: 50, label: "Playoffs" },
  ] },
];

export const finalFour2025: PostseasonGame2025[] = [
  { id: "25-sf-1", stage: "Ημιτελικός", homeTeam: "ΛΕΚΑΒΕΞ", awayTeam: "LOS PROFESORES", homeScore: 65, awayScore: 46 },
  { id: "25-sf-2", stage: "Ημιτελικός", homeTeam: "PONTIAKOS", awayTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", homeScore: 69, awayScore: 83 },
  { id: "25-third", stage: "Μικρός τελικός", homeTeam: "LOS PROFESORES", awayTeam: "PONTIAKOS", homeScore: 42, awayScore: 76 },
  { id: "25-final", stage: "Τελικός", homeTeam: "ΛΕΚΑΒΕΞ", awayTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", homeScore: 76, awayScore: 52, note: "Πρωταθλήτρια 2025-26: ΛΕΚΑΒΕΞ" },
];

export const stratosMylonasCup2025: PostseasonGame2025[] = [
  { id: "25-cup-1", stage: "Φάση των 16", homeTeam: "SIDE EFFECTS", awayTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", homeScore: 61, awayScore: 104 },
  { id: "25-cup-2", stage: "Φάση των 16", homeTeam: "ΣΟΥΒLAKERS", awayTeam: "PONTIAKOS", homeScore: 55, awayScore: 80 },
  { id: "25-cup-3", stage: "Φάση των 16", homeTeam: "CUSTOMS BC", awayTeam: "NETMEN", homeScore: 73, awayScore: 40 },
  { id: "25-cup-4", stage: "Φάση των 16", homeTeam: "CHICKEN NUGGETS", awayTeam: "ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ", note: "Ο αγώνας δεν διεξήχθη - πρόκριση CUSTOMS BC στην επόμενη φάση." },
  { id: "25-cup-5", stage: "Φάση των 16", homeTeam: "ΣΙDREAM TEAM", awayTeam: "ΓΙΟΥΧΑ JAZZ", homeScore: 63, awayScore: 57 },
  { id: "25-cup-6", stage: "Φάση των 16", homeTeam: "BEERWAUKEE ΜΠΑΚΕΣ", awayTeam: "ΛΕΚΑΒΕΞ", homeScore: 62, awayScore: 74 },
  { id: "25-cup-7", stage: "Φάση των 16", homeTeam: "JUGOPIASTIKA", awayTeam: "LOS PROFESORES", homeScore: 56, awayScore: 70 },
  { id: "25-cup-8", stage: "Φάση των 16", homeTeam: "LOS BADOLEROS", awayTeam: "RODOPI ROCKETS", homeScore: 64, awayScore: 34 },
  { id: "25-cup-9", stage: "Φάση των 8", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "PONTIAKOS", homeScore: 78, awayScore: 51 },
  { id: "25-cup-10", stage: "Φάση των 8", homeTeam: "CUSTOMS BC", awayTeam: "Πρόκριση άνευ αγώνα", note: "Το ζευγάρι CHICKEN NUGGETS - ΠΑΛΑΙΜΑΧΟΙ ΑΙΑΣ δεν διεξήχθη." },
  { id: "25-cup-11", stage: "Φάση των 8", homeTeam: "ΣΙDREAM TEAM", awayTeam: "ΛΕΚΑΒΕΞ", homeScore: 51, awayScore: 63 },
  { id: "25-cup-12", stage: "Φάση των 8", homeTeam: "LOS PROFESORES", awayTeam: "LOS BADOLEROS", homeScore: 69, awayScore: 63 },
  { id: "25-cup-13", stage: "Final4 Κυπέλλου", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "CUSTOMS BC", homeScore: 86, awayScore: 44 },
  { id: "25-cup-14", stage: "Final4 Κυπέλλου", homeTeam: "ΛΕΚΑΒΕΞ", awayTeam: "LOS PROFESORES", homeScore: 75, awayScore: 66 },
  { id: "25-cup-15", stage: "Τελικός", homeTeam: "ΑΠΑΡΑΔΕΚΤΟΙ", awayTeam: "ΛΕΚΑΒΕΞ", homeScore: 55, awayScore: 67, note: "Κυπελλούχος 2025-26: ΛΕΚΑΒΕΞ" },
];
