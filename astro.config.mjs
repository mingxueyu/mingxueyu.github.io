// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://treefish.top",
  base: "/",
  markdown: {
    shikiConfig: {
      theme: "github-dark",
    },
  },
  vite: {
    server: {
      watch: {
        ignored: ["**/public/audio/**"],
      },
    },
  },
});
