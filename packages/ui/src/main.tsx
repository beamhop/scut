import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Announcer, CommandPalette, applyTheme } from "./ui/index.ts";

applyTheme();

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <Announcer />
    <CommandPalette />
  </>,
);
