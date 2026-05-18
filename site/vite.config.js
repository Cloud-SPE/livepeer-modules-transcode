import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: process.env.GATEWAY_URL || "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        index: "index.html",
        verify: "verify.html",
      },
    },
  },
});
