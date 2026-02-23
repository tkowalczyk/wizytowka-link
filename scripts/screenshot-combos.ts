/**
 * Screenshot all 90 logo combo pages.
 * Requires: wrangler dev running on :8787
 * Usage: npx playwright test --config=- < /dev/null || npx tsx scripts/screenshot-combos.ts
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:8787';

interface Combo {
  layout: string;
  style: string;
  logo: string;
  slug: string;
}

const combos: Combo[] = [
  // warm-food (restauracja)
  { layout: 'centered', style: 'modern', logo: 'warm-food', slug: 'test-restauracja-19' },
  { layout: 'centered', style: 'elegant', logo: 'warm-food', slug: 'test-restauracja-2' },
  { layout: 'centered', style: 'bold', logo: 'warm-food', slug: 'test-restauracja-3' },
  { layout: 'split', style: 'modern', logo: 'warm-food', slug: 'test-restauracja-1' },
  { layout: 'split', style: 'elegant', logo: 'warm-food', slug: 'test-restauracja-4' },
  { layout: 'split', style: 'bold', logo: 'warm-food', slug: 'test-restauracja-10' },
  { layout: 'minimal', style: 'modern', logo: 'warm-food', slug: 'test-restauracja-5' },
  { layout: 'minimal', style: 'elegant', logo: 'warm-food', slug: 'test-restauracja-16' },
  { layout: 'minimal', style: 'bold', logo: 'warm-food', slug: 'test-restauracja-0' },
  // warm-cafe (kawiarnia)
  { layout: 'centered', style: 'modern', logo: 'warm-cafe', slug: 'test-kawiarnia-0' },
  { layout: 'centered', style: 'elegant', logo: 'warm-cafe', slug: 'test-kawiarnia-5' },
  { layout: 'centered', style: 'bold', logo: 'warm-cafe', slug: 'test-kawiarnia-14' },
  { layout: 'split', style: 'modern', logo: 'warm-cafe', slug: 'test-kawiarnia-8' },
  { layout: 'split', style: 'elegant', logo: 'warm-cafe', slug: 'test-kawiarnia-3' },
  { layout: 'split', style: 'bold', logo: 'warm-cafe', slug: 'test-kawiarnia-11' },
  { layout: 'minimal', style: 'modern', logo: 'warm-cafe', slug: 'test-kawiarnia-1' },
  { layout: 'minimal', style: 'elegant', logo: 'warm-cafe', slug: 'test-kawiarnia-7' },
  { layout: 'minimal', style: 'bold', logo: 'warm-cafe', slug: 'test-kawiarnia-2' },
  // warm-florist (kwiaciarnia)
  { layout: 'centered', style: 'modern', logo: 'warm-florist', slug: 'test-kwiaciarnia-6' },
  { layout: 'centered', style: 'elegant', logo: 'warm-florist', slug: 'test-kwiaciarnia-1' },
  { layout: 'centered', style: 'bold', logo: 'warm-florist', slug: 'test-kwiaciarnia-0' },
  { layout: 'split', style: 'modern', logo: 'warm-florist', slug: 'test-kwiaciarnia-9' },
  { layout: 'split', style: 'elegant', logo: 'warm-florist', slug: 'test-kwiaciarnia-18' },
  { layout: 'split', style: 'bold', logo: 'warm-florist', slug: 'test-kwiaciarnia-4' },
  { layout: 'minimal', style: 'modern', logo: 'warm-florist', slug: 'test-kwiaciarnia-2' },
  { layout: 'minimal', style: 'elegant', logo: 'warm-florist', slug: 'test-kwiaciarnia-3' },
  { layout: 'minimal', style: 'bold', logo: 'warm-florist', slug: 'test-kwiaciarnia-8' },
  // clinical-medical (lekarz)
  { layout: 'centered', style: 'modern', logo: 'clinical-medical', slug: 'test-lekarz-5' },
  { layout: 'centered', style: 'elegant', logo: 'clinical-medical', slug: 'test-lekarz-16' },
  { layout: 'centered', style: 'bold', logo: 'clinical-medical', slug: 'test-lekarz-0' },
  { layout: 'split', style: 'modern', logo: 'clinical-medical', slug: 'test-lekarz-1' },
  { layout: 'split', style: 'elegant', logo: 'clinical-medical', slug: 'test-lekarz-10' },
  { layout: 'split', style: 'bold', logo: 'clinical-medical', slug: 'test-lekarz-15' },
  { layout: 'minimal', style: 'modern', logo: 'clinical-medical', slug: 'test-lekarz-2' },
  { layout: 'minimal', style: 'elegant', logo: 'clinical-medical', slug: 'test-lekarz-8' },
  { layout: 'minimal', style: 'bold', logo: 'clinical-medical', slug: 'test-lekarz-3' },
  // clinical-vet (weterynarz)
  { layout: 'centered', style: 'modern', logo: 'clinical-vet', slug: 'test-weterynarz-12' },
  { layout: 'centered', style: 'elegant', logo: 'clinical-vet', slug: 'test-weterynarz-3' },
  { layout: 'centered', style: 'bold', logo: 'clinical-vet', slug: 'test-weterynarz-8' },
  { layout: 'split', style: 'modern', logo: 'clinical-vet', slug: 'test-weterynarz-2' },
  { layout: 'split', style: 'elegant', logo: 'clinical-vet', slug: 'test-weterynarz-7' },
  { layout: 'split', style: 'bold', logo: 'clinical-vet', slug: 'test-weterynarz-4' },
  { layout: 'minimal', style: 'modern', logo: 'clinical-vet', slug: 'test-weterynarz-6' },
  { layout: 'minimal', style: 'elegant', logo: 'clinical-vet', slug: 'test-weterynarz-1' },
  { layout: 'minimal', style: 'bold', logo: 'clinical-vet', slug: 'test-weterynarz-0' },
  // clinical-pharmacy (apteka)
  { layout: 'centered', style: 'modern', logo: 'clinical-pharmacy', slug: 'test-apteka-18' },
  { layout: 'centered', style: 'elegant', logo: 'clinical-pharmacy', slug: 'test-apteka-0' },
  { layout: 'centered', style: 'bold', logo: 'clinical-pharmacy', slug: 'test-apteka-1' },
  { layout: 'split', style: 'modern', logo: 'clinical-pharmacy', slug: 'test-apteka-7' },
  { layout: 'split', style: 'elegant', logo: 'clinical-pharmacy', slug: 'test-apteka-2' },
  { layout: 'split', style: 'bold', logo: 'clinical-pharmacy', slug: 'test-apteka-9' },
  { layout: 'minimal', style: 'modern', logo: 'clinical-pharmacy', slug: 'test-apteka-3' },
  { layout: 'minimal', style: 'elegant', logo: 'clinical-pharmacy', slug: 'test-apteka-11' },
  { layout: 'minimal', style: 'bold', logo: 'clinical-pharmacy', slug: 'test-apteka-8' },
  // industrial-mechanic (mechanik)
  { layout: 'centered', style: 'modern', logo: 'industrial-mechanic', slug: 'test-mechanik-9' },
  { layout: 'centered', style: 'elegant', logo: 'industrial-mechanic', slug: 'test-mechanik-19' },
  { layout: 'centered', style: 'bold', logo: 'industrial-mechanic', slug: 'test-mechanik-4' },
  { layout: 'split', style: 'modern', logo: 'industrial-mechanic', slug: 'test-mechanik-5' },
  { layout: 'split', style: 'elegant', logo: 'industrial-mechanic', slug: 'test-mechanik-15' },
  { layout: 'split', style: 'bold', logo: 'industrial-mechanic', slug: 'test-mechanik-0' },
  { layout: 'minimal', style: 'modern', logo: 'industrial-mechanic', slug: 'test-mechanik-2' },
  { layout: 'minimal', style: 'elegant', logo: 'industrial-mechanic', slug: 'test-mechanik-1' },
  { layout: 'minimal', style: 'bold', logo: 'industrial-mechanic', slug: 'test-mechanik-7' },
  // industrial-plumber (hydraulik)
  { layout: 'centered', style: 'modern', logo: 'industrial-plumber', slug: 'test-hydraulik-4' },
  { layout: 'centered', style: 'elegant', logo: 'industrial-plumber', slug: 'test-hydraulik-9' },
  { layout: 'centered', style: 'bold', logo: 'industrial-plumber', slug: 'test-hydraulik-27' },
  { layout: 'split', style: 'modern', logo: 'industrial-plumber', slug: 'test-hydraulik-8' },
  { layout: 'split', style: 'elegant', logo: 'industrial-plumber', slug: 'test-hydraulik-0' },
  { layout: 'split', style: 'bold', logo: 'industrial-plumber', slug: 'test-hydraulik-3' },
  { layout: 'minimal', style: 'modern', logo: 'industrial-plumber', slug: 'test-hydraulik-1' },
  { layout: 'minimal', style: 'elegant', logo: 'industrial-plumber', slug: 'test-hydraulik-7' },
  { layout: 'minimal', style: 'bold', logo: 'industrial-plumber', slug: 'test-hydraulik-2' },
  // industrial-electric (elektryk)
  { layout: 'centered', style: 'modern', logo: 'industrial-electric', slug: 'test-elektryk-6' },
  { layout: 'centered', style: 'elegant', logo: 'industrial-electric', slug: 'test-elektryk-1' },
  { layout: 'centered', style: 'bold', logo: 'industrial-electric', slug: 'test-elektryk-0' },
  { layout: 'split', style: 'modern', logo: 'industrial-electric', slug: 'test-elektryk-2' },
  { layout: 'split', style: 'elegant', logo: 'industrial-electric', slug: 'test-elektryk-11' },
  { layout: 'split', style: 'bold', logo: 'industrial-electric', slug: 'test-elektryk-7' },
  { layout: 'minimal', style: 'modern', logo: 'industrial-electric', slug: 'test-elektryk-9' },
  { layout: 'minimal', style: 'elegant', logo: 'industrial-electric', slug: 'test-elektryk-3' },
  { layout: 'minimal', style: 'bold', logo: 'industrial-electric', slug: 'test-elektryk-4' },
  // default (fryzjer)
  { layout: 'centered', style: 'modern', logo: 'default', slug: 'test-fryzjer-7' },
  { layout: 'centered', style: 'elegant', logo: 'default', slug: 'test-fryzjer-6' },
  { layout: 'centered', style: 'bold', logo: 'default', slug: 'test-fryzjer-1' },
  { layout: 'split', style: 'modern', logo: 'default', slug: 'test-fryzjer-14' },
  { layout: 'split', style: 'elegant', logo: 'default', slug: 'test-fryzjer-0' },
  { layout: 'split', style: 'bold', logo: 'default', slug: 'test-fryzjer-5' },
  { layout: 'minimal', style: 'modern', logo: 'default', slug: 'test-fryzjer-3' },
  { layout: 'minimal', style: 'elegant', logo: 'default', slug: 'test-fryzjer-4' },
  { layout: 'minimal', style: 'bold', logo: 'default', slug: 'test-fryzjer-8' },
];

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  for (const c of combos) {
    const url = `${BASE}/testowo/${c.slug}`;
    const filename = `${c.logo}_${c.layout}_${c.style}.png`;
    process.stdout.write(`${filename} ... `);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.screenshot({ path: `screenshots/${filename}`, fullPage: true });
      console.log('ok');
    } catch (e) {
      console.log(`FAIL: ${(e as Error).message}`);
    }
  }

  await browser.close();
  console.log(`\nDone! Screenshots saved to screenshots/`);
}

run();
