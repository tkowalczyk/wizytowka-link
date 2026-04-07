/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

// Augment the wrangler-generated Env type with secrets that wrangler types
// cannot discover (e.g. values held in .dev.vars / .production.vars only).
declare namespace Cloudflare {
	interface Env {
		ADMIN_PANEL_URL: string;
	}
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {}
}
