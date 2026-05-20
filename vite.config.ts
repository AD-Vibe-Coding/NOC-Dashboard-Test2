import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { slackProxyPlugin } from "./vite-plugins/slack-proxy";
import { zoomProxyPlugin } from "./vite-plugins/zoom-proxy";
import { confluenceProxyPlugin } from "./vite-plugins/confluence-proxy";
import { aiProxyPlugin } from "./vite-plugins/ai-proxy";
import { wfhProxyPlugin } from "./vite-plugins/wfh-proxy";
import { logicMonitorProxyPlugin } from "./vite-plugins/logicmonitor-proxy";
import { appbuilderApiDevServer } from "./vite-plugins/appbuilder-api-dev-server";

export default defineConfig({
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  plugins: [
    react(),
    // appbuilderApiDevServer MUST come before the other proxy plugins so
    // its /api middleware is registered first and can pick up table CRUD
    // routes under api/<table>.ts before any catch-all matchers below.
    appbuilderApiDevServer(),
    slackProxyPlugin(),
    zoomProxyPlugin(),
    confluenceProxyPlugin(),
    aiProxyPlugin(),
    wfhProxyPlugin(),
    logicMonitorProxyPlugin(),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // strictPort: a stale "npm run dev" leaves Vite drifting to 5174/5175 and the
    // saved app.url (which routes to the bare host = primary port) intermittently
    // 502s. Crash on conflict instead so the wake handler sees a real error.
    strictPort: true,
    // allowedHosts must be true: sandboxes are accessed via dynamic Vercel-assigned hostnames
    allowedHosts: true,
  },
});
