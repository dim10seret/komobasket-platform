import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "./styles/global.css";

void window.komoControl?.getAppInfo().then((info) => {
    document.title = `KomoControl ${info.version}`;
});

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
