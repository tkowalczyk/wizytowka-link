import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		pool: cloudflarePool({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				d1Databases: { leadgen: "leadgen" },
				r2Buckets: ["sites"],
				kvNamespaces: ["STATE"],
				bindings: {
					TG_NOTIFY_BOT_TOKEN: "test-notify-token",
					ADMIN_PANEL_URL: "https://example.test/panel/test-token",
					ADMIN_TOKEN: "test-admin-token",
				},
			},
		}),
	},
});
