import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget =
    env.VITE_DEV_PROXY_TARGET ||
    env.VITE_API_PROXY_TARGET ||
    "https://aicostledger-prod-usw1-a87bf2.web.app";
  const port = Number(env.VITE_DEV_PORT || env.PORT || 5176);

  return {
    plugins: [react({ include: [/\\.[tj]sx?$/] })],
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"]
    },
    server: {
      port,
      strictPort: true,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          secure: true
        },
        "/collector": {
          target: proxyTarget,
          changeOrigin: true,
          secure: true
        }
      }
    }
  };
});
