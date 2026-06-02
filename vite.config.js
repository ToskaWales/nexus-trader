import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Actions sets VITE_BASE_URL to "/<repo-name>/" automatically.
  // Falls back to "/" for local dev or a custom domain.
  base: process.env.VITE_BASE_URL ?? "/",
  server: {
    proxy: {
      "/anthropic": {
        target: "https://api.anthropic.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/anthropic/, ""),
        secure: true,
      },
      "/yahoo": {
        target: "https://query1.finance.yahoo.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yahoo/, ""),
        secure: true,
      },
    },
  },
});
