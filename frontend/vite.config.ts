import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api/chat/ws": { target: "ws://localhost:8000", ws: true },
      "/api": "http://localhost:8000",
      "/uploads": "http://localhost:8000",
    },
  },
});
