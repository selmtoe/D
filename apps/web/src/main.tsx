import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { configurePwaUpdater, markPwaUpdatePending } from "./app/pwaUpdate";
import "./styles/global.css";

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh: markPwaUpdatePending,
});
configurePwaUpdater(() => updateServiceWorker(true));
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
