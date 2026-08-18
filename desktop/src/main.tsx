import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HowboutApp } from "../../web/app/HowboutApp";
import "../../web/app/globals.css";
import "../../web/app/howbout.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HowboutApp />
  </StrictMode>,
);
