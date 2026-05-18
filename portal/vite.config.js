import { defineConfig } from "vite";

const target = process.env.GATEWAY_URL || "http://localhost:4000";

export default defineConfig({
  server: {
    port: 3002,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/v1": { target, changeOrigin: true },
    },
  },
  build: { target: "es2022" },
});
