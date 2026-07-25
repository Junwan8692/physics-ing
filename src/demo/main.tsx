import { createRoot } from "react-dom/client";
import { ViewerDemo } from "./ViewerDemo";

// StrictMode를 쓰지 않는다. 개발 모드 이중 마운트가 WebGL 컨텍스트를 두 벌 만들고,
// 브라우저 컨텍스트 상한(보통 16)에 그만큼 빨리 붙는다 (스펙 §4.8).
const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(<ViewerDemo />);
