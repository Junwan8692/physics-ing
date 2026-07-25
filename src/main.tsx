import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorApp } from "./editor/EditorApp";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <EditorApp />
  </StrictMode>,
);
