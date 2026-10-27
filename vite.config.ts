// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import type { Plugin, PluginOption } from "vite";

/**
 * TanStack Start builds three Vite environments: `client`, `ssr` and `nitro`.
 * vite-plugin-pwa is not environment aware — left alone it also runs in the
 * `ssr` and `nitro` builds, writing a second sw.js next to the server bundle and
 * emitting manifest.webmanifest into `.output/server`. Scope every PWA plugin to
 * the `client` environment so the service worker only ever describes the
 * browser build it serves.
 */
function clientOnly(plugins: PluginOption[]): PluginOption[] {
  return plugins.map((plugin): PluginOption => {
    if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) return plugin;
    const pwaPlugin = plugin as Plugin;
    const scopedPlugin: Plugin = {
      ...pwaPlugin,
      applyToEnvironment: (environment) => environment.name === "client",
    };
    return scopedPlugin;
  });
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  plugins: [
    // PWA: installable on mobile + automatic updates on deploy.
    // `registerType: 'autoUpdate'` swaps in the new service worker and reloads
    // open tabs when a deploy lands. Registration itself lives in
    // src/components/ServiceWorkerRegistrar.tsx (client-only) because TanStack
    // Start renders HTML from `shellComponent`, so there is no index.html for
    // the plugin to inject a <script> into.
    ...clientOnly(
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: false,
        // The client build writes into nitro's public directory.
        outDir: ".output/public",
        includeAssets: ["favicon.png", "apple-touch-icon.png", "logo.png", "robots.txt"],
        manifest: {
          name: "Roket.bond",
          short_name: "Roket",
          description: "Roket crypto trading plans.",
          theme_color: "#0B1120",
          background_color: "#0B1120",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,svg,ico,woff,woff2}"],
          // Pages are server-rendered: there is no static index.html to use as a
          // navigation fallback, and precaching a missing file would break the
          // install. Navigations are cached at runtime instead, so an offline
          // reload replays the last visited page.
          navigateFallback: null,
          cleanupOutdatedCaches: true,
          // registerType 'autoUpdate' only implies these when the plugin also
          // injects its own registration script; we register manually, so ask
          // for them explicitly.
          skipWaiting: true,
          clientsClaim: true,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "pages",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ),
  ],
  vite: {
    server: {
      host: "0.0.0.0",
      port: 4000,
      strictPort: true,
      allowedHosts: true,
    },
  },
});
