/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

type Runtime = import("@astrojs/cloudflare").Runtime;

declare namespace App {
	interface Locals extends Runtime {}
}
