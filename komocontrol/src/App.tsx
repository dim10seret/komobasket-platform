import { HashRouter, Routes, Route } from "react-router-dom";

import Dashboard from "./pages/Dashboard/Dashboard";
import LiveMatch from "./pages/LiveMatch/LiveMatch";
import Teams from "./pages/Teams/Teams";
import Players from "./pages/Players/Players";
import Settings from "./pages/Settings/Settings";
import MatchReport from "./pages/MatchReport/MatchReport";
import Matches from "./pages/Matches/Matches";
import NotFound from "./pages/NotFound/NotFound";

function App() {
    return (
        <HashRouter>
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/live" element={<LiveMatch />} />
                <Route path="/teams" element={<Teams />} />
                <Route path="/players" element={<Players />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/report" element={<MatchReport />} />
                <Route path="/matches" element={<Matches />} />
                <Route path="*" element={<NotFound />} />
            </Routes>
        </HashRouter>
    );
}

export default App;
