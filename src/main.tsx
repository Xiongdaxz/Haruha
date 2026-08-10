import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TrayPanel } from "./components/tray/TrayPanel";
import "./styles.css";

const isTrayView = new URLSearchParams(window.location.search).get("view") === "tray";
document.documentElement.classList.toggle("tray-view", isTrayView);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isTrayView ? <TrayPanel /> : <App />}
  </StrictMode>,
);
