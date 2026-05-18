import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
	output: "server",
	trailingSlash: "never",
	adapter: cloudflare({
		imageService: "cloudflare",
	}),
	vite: {
		plugins: [tailwindcss()],
		ssr: {
			external: ["node:fs/promises", "node:path", "node:url", "node:crypto"],
		},
	},
});
