PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS league_supporters (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES league_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT NOT NULL,
  description TEXT,
  website_url TEXT,
  display_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_league_supporters_organization_status_order
  ON league_supporters(organization_id, status, display_order, name, id);

INSERT INTO league_supporters
  (id, organization_id, name, logo_url, description, website_url, display_order, status)
VALUES
  ('supporter_komobasket_red_cross', 'organization_komobasket', 'Ελληνικός Ερυθρός Σταυρός – Περιφερειακό Τμήμα Κομοτηνής', '/images/supporters/erithros-stauros-komotinis.jpg', 'Το Περιφερειακό Τμήμα Κομοτηνής του Ελληνικού Ερυθρού Σταυρού αποτελεί έναν διαχρονικό και πολύτιμο υποστηρικτή του KomoBasket, προσφέροντας με συνέπεια την υγειονομική κάλυψη των αγώνων μέσω των εθελοντών Σαμαρειτών του. Η διαρκής παρουσία τους συμβάλλει καθοριστικά στην ασφαλή διεξαγωγή της διοργάνωσης, αναδεικνύοντας τις αξίες του εθελοντισμού, της αλληλεγγύης και της κοινωνικής προσφοράς. Το KomoBasket εκφράζει την ειλικρινή του εκτίμηση για τη διαχρονική αυτή συνεργασία, η οποία ενισχύει το αίσθημα ασφάλειας όλων των συμμετεχόντων.', 'https://www.facebook.com/komotiniredcross/?locale=el_GR', 1, 'active'),
  ('supporter_komotini_municipality', 'organization_komobasket', 'Δήμος Κομοτηνής', '/images/supporters/dimos-komotinis.jpg', 'Ο Δήμος Κομοτηνής αποτελεί σταθερό υποστηρικτή του KomoBasket, συμβάλλοντας ουσιαστικά στην ανάπτυξη του αθλητισμού και στην ενίσχυση δράσεων που φέρνουν τους πολίτες πιο κοντά. Μέσα από αυτή τη συνεργασία δημιουργούνται περισσότερες ευκαιρίες συμμετοχής, διά βίου άθλησης και δημιουργικής έκφρασης, ενώ παράλληλα προβάλλονται οι αξίες της ομαδικότητας και του ευ αγωνίζεσθαι. Το KomoBasket αναδεικνύει τη διαρκή προσφορά του Δήμου και ενισχύει την κοινή προσπάθεια για μια πόλη δραστήρια, εξωστρεφή και ανοιχτή σε όλους.', 'https://komotini.gr/', 2, 'active'),
  ('supporter_sefaa_duth', 'organization_komobasket', 'Σχολή Επιστήμης Φυσικής Αγωγής και Αθλητισμού – Δημοκρίτειο Πανεπιστήμιο Θράκης', '/images/supporters/sefaa-duth.jpg', 'Η Σχολή Επιστήμης Φυσικής Αγωγής και Αθλητισμού του Δημοκρίτειου Πανεπιστημίου Θράκης αποτελεί σημαντικό ακαδημαϊκό και επιστημονικό υποστηρικτή του KomoBasket. Η συνεργασία συνδέει τη γνώση, την έρευνα και την εκπαιδευτική εμπειρία με τη ζωντανή πραγματικότητα μιας σύγχρονης αθλητικής διοργάνωσης, δημιουργώντας πεδίο πρακτικής εφαρμογής και ενεργού συμμετοχής για φοιτητές και μέλη της ακαδημαϊκής κοινότητας. Παράλληλα, ενισχύει την ανταλλαγή τεχνογνωσίας, την ανάπτυξη καινοτόμων δράσεων και τη διαμόρφωση μιας ισχυρής γέφυρας ανάμεσα στο Πανεπιστήμιο, τον αθλητισμό και την τοπική κοινωνία.', 'https://duth.gr/schools/phyed/', 3, 'active');
