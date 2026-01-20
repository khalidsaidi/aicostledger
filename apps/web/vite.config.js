import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const fallbackTarget = "https://aicostledger-prod-usw1-a87bf2.web.app";
    const apiProxyTarget = env.VITE_API_PROXY_TARGET ||
        env.VITE_DEV_PROXY_TARGET ||
        fallbackTarget;
    const collectorProxyTarget = env.VITE_COLLECTOR_PROXY_TARGET ||
        env.VITE_DEV_PROXY_TARGET ||
        fallbackTarget;
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
                    target: apiProxyTarget,
                    changeOrigin: true,
                    secure: true
                },
                "/collector": {
                    target: collectorProxyTarget,
                    changeOrigin: true,
                    secure: true
                }
            }
        }
    };
});
