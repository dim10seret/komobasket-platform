import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "./styles/global.css";

if (window.komoControl) {
    void Promise.all([
        window.komoControl.getAppInfo(),
        window.komoControl.getLocalStatus(),
    ]).then(([info, localStatus]) => {
        document.title = `KomoControl ${info.version}`;
        document.documentElement.dataset.localDatabase = localStatus.ready ? "ready" : "unavailable";
    });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
