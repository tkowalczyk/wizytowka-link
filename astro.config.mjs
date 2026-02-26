import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  trailingSlash: 'never',
  adapter: cloudflare({
    imageService: 'cloudflare',
    workerEntryPoint: {
      path: 'src/worker.ts',
    },
  }),
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      external: ['node:fs/promises', 'node:path', 'node:url', 'node:crypto'],
    },
  },
});
