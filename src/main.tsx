import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { APP_NAME } from "./app/constants";
import { TrayPanel } from "./components/tray/TrayPanel";
import "./styles.css";

const isTrayView = new URLSearchParams(window.location.search).get("view") === "tray";
document.title = isTrayView ? `${APP_NAME} 快捷面板` : APP_NAME;
document.documentElement.classList.toggle("tray-view", isTrayView);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isTrayView ? <TrayPanel /> : <App />}
  </StrictMode>,
);
