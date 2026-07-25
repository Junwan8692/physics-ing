import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 진입점 둘: index.html(저작툴), demo.html(뷰어 데모).
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        demo: fileURLToPath(new URL("demo.html", import.meta.url)),
      },
    },
  },
});
