import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'server',
  integrations: [tailwind()],
  adapter: cloudflare({
    imageService: 'cloudflare',
    workerEntryPoint: {
      path: 'src/worker.ts',
    },
  }),
  vite: {
    ssr: {
      external: ['node:fs/promises', 'node:path', 'node:url', 'node:crypto'],
    },
  },
});
