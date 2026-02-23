import { chromium } from 'playwright';

const combos = [
  { layout: 'centered', style: 'modern', slug: 'test-apteka-18' },
  { layout: 'centered', style: 'elegant', slug: 'test-apteka-0' },
  { layout: 'centered', style: 'bold', slug: 'test-apteka-1' },
  { layout: 'split', style: 'modern', slug: 'test-apteka-7' },
  { layout: 'split', style: 'elegant', slug: 'test-apteka-2' },
  { layout: 'split', style: 'bold', slug: 'test-apteka-9' },
  { layout: 'minimal', style: 'modern', slug: 'test-apteka-3' },
  { layout: 'minimal', style: 'elegant', slug: 'test-apteka-11' },
  { layout: 'minimal', style: 'bold', slug: 'test-apteka-8' },
];

async function run() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  for (const c of combos) {
    const f = `clinical-pharmacy_${c.layout}_${c.style}.png`;
    process.stdout.write(`${f} ... `);
    await page.goto(`http://localhost:8787/testowo/${c.slug}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.screenshot({ path: `screenshots/${f}`, fullPage: true });
    console.log('ok');
  }
  await browser.close();
}
run();
