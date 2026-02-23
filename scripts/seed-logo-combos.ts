/**
 * Seed local D1 + R2 with 90 test businesses covering all layout×style×logo combos.
 * Usage: pnpm tsx scripts/seed-logo-combos.ts
 * Then: pnpm preview → URLs printed at end
 */
import { execSync } from 'node:child_process';

function sql(cmd: string) {
  const escaped = cmd.replace(/'/g, "'\\''");
  execSync(`pnpm wrangler d1 execute leadgen --local --command '${escaped}'`, { stdio: 'inherit' });
}

function r2put(key: string, body: string) {
  execSync(`echo '${body.replace(/'/g, "'\\''")}' | pnpm wrangler r2 object put "sites/${key}" --local --pipe`, { stdio: 'inherit' });
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const LAYOUTS = ['centered', 'split', 'minimal'] as const;
const STYLES = ['modern', 'elegant', 'bold'] as const;

function pickLayout(slug: string) { return LAYOUTS[hashStr(slug + '_layout') % 3]; }
function pickStyle(slug: string) { return STYLES[hashStr(slug + '_style') % 3]; }

interface CategoryDef {
  category: string;
  logoKey: string;
  title: string;
  headline: string;
  sub: string;
  about: string;
  services: { name: string; description: string }[];
}

const CATEGORIES: CategoryDef[] = [
  {
    category: 'restauracja', logoKey: 'warm-food',
    title: 'Restauracja Pod Lipą', headline: 'Restauracja Pod Lipą', sub: 'Domowa kuchnia polska',
    about: 'Tradycyjna kuchnia polska w sercu miasta. Codzienne obiady, catering i organizacja imprez okolicznościowych.',
    services: [
      { name: 'Obiady domowe', description: 'Codzienne dania obiadowe z dostawą' },
      { name: 'Catering', description: 'Obsługa imprez i wydarzeń firmowych' },
      { name: 'Imprezy okolicznościowe', description: 'Wesela, komunie, urodziny' },
    ],
  },
  {
    category: 'kawiarnia', logoKey: 'warm-cafe',
    title: 'Kawiarnia Ziarno', headline: 'Kawiarnia Ziarno', sub: 'Kawa speciality i domowe ciasta',
    about: 'Przytulna kawiarnia z szerokim wyborem kaw specialty i domowych wypieków. Idealne miejsce na spotkanie.',
    services: [
      { name: 'Kawa speciality', description: 'Starannie wyselekcjonowane ziarna z całego świata' },
      { name: 'Domowe ciasta', description: 'Codziennie świeże wypieki' },
      { name: 'Śniadania', description: 'Pełne menu śniadaniowe do 12:00' },
    ],
  },
  {
    category: 'kwiaciarnia', logoKey: 'warm-florist',
    title: 'Kwiaciarnia Róża', headline: 'Kwiaciarnia Róża', sub: 'Bukiety i dekoracje kwiatowe',
    about: 'Profesjonalna kwiaciarnia oferująca bukiety na każdą okazję, dekoracje ślubne i dostawy kwiatów.',
    services: [
      { name: 'Bukiety okolicznościowe', description: 'Na urodziny, imieniny, rocznice' },
      { name: 'Dekoracje ślubne', description: 'Kompleksowa florystyka ślubna' },
      { name: 'Dostawa kwiatów', description: 'Szybka dostawa na terenie miasta' },
    ],
  },
  {
    category: 'lekarz', logoKey: 'clinical-medical',
    title: 'Dr Anna Kowalska', headline: 'Gabinet lekarski', sub: 'Medycyna rodzinna i internistyczna',
    about: 'Gabinet lekarza rodzinnego z wieloletnim doświadczeniem. Diagnostyka, profilaktyka i leczenie schorzeń wewnętrznych.',
    services: [
      { name: 'Konsultacje lekarskie', description: 'Wizyty w gabinecie i teleporady' },
      { name: 'Badania diagnostyczne', description: 'Morfologia, USG, EKG' },
      { name: 'Szczepienia', description: 'Kalendarz szczepień i szczepienia dodatkowe' },
    ],
  },
  {
    category: 'weterynarz', logoKey: 'clinical-vet',
    title: 'Lecznica Zwierząt Łapa', headline: 'Lecznica Zwierząt Łapa', sub: 'Opieka weterynaryjna',
    about: 'Nowoczesna lecznica dla zwierząt domowych. Chirurgia, stomatologia, diagnostyka obrazowa i laboratorjyjna.',
    services: [
      { name: 'Wizyty kontrolne', description: 'Regularne badania i profilaktyka' },
      { name: 'Chirurgia', description: 'Zabiegi operacyjne w pełnym zakresie' },
      { name: 'Stomatologia', description: 'Leczenie i higiena jamy ustnej zwierząt' },
    ],
  },
  {
    category: 'apteka', logoKey: 'clinical-pharmacy',
    title: 'Apteka Zdrowie', headline: 'Apteka Zdrowie', sub: 'Twoja apteka pierwszego wyboru',
    about: 'Apteka z pełnym asortymentem leków, suplementów i dermokosmetyków. Fachowe doradztwo farmaceutyczne.',
    services: [
      { name: 'Leki na receptę', description: 'Realizacja recept elektronicznych i papierowych' },
      { name: 'Dermokosmetyki', description: 'Profesjonalna pielęgnacja skóry' },
      { name: 'Doradztwo', description: 'Porady farmaceutyczne i dobór leków OTC' },
    ],
  },
  {
    category: 'mechanik', logoKey: 'industrial-mechanic',
    title: 'Auto-Serwis Kowalski', headline: 'Auto-Serwis Kowalski', sub: 'Kompleksowa naprawa aut',
    about: 'Warsztat samochodowy z pełnym zapleczem diagnostycznym. Naprawy mechaniczne, elektryczne i blacharsko-lakiernicze.',
    services: [
      { name: 'Mechanika pojazdowa', description: 'Naprawa silników, zawieszenia, hamulców' },
      { name: 'Diagnostyka komputerowa', description: 'Odczyt i kasowanie błędów' },
      { name: 'Klimatyzacja', description: 'Serwis i napełnianie klimatyzacji' },
    ],
  },
  {
    category: 'hydraulik', logoKey: 'industrial-plumber',
    title: 'Hydraulik Nowak', headline: 'Usługi hydrauliczne Nowak', sub: 'Instalacje wod-kan i CO',
    about: 'Profesjonalne usługi hydrauliczne — instalacje, naprawy i udrażnianie rur. Szybka pomoc w awariach.',
    services: [
      { name: 'Instalacje wod-kan', description: 'Montaż nowych instalacji wodnych i kanalizacyjnych' },
      { name: 'Centralne ogrzewanie', description: 'Instalacja i serwis CO i podłogówki' },
      { name: 'Awarie 24h', description: 'Szybka pomoc przy przeciekach i awariach' },
    ],
  },
  {
    category: 'elektryk', logoKey: 'industrial-electric',
    title: 'ElektroMax', headline: 'ElektroMax - usługi elektryczne', sub: 'Instalacje i naprawy',
    about: 'Certyfikowany elektryk z uprawnieniami SEP. Instalacje domowe i przemysłowe, pomiary, awarie.',
    services: [
      { name: 'Instalacje elektryczne', description: 'Nowe instalacje i modernizacje' },
      { name: 'Pomiary elektryczne', description: 'Okresowe badania i protokoły' },
      { name: 'Awarie', description: 'Szybka lokalizacja i naprawa usterek' },
    ],
  },
  {
    category: 'fryzjer', logoKey: 'default',
    title: 'Salon Fryzjerski Styl', headline: 'Salon Fryzjerski Styl', sub: 'Strzyżenie, koloryzacja, stylizacja',
    about: 'Nowoczesny salon fryzjerski dla kobiet i mężczyzn. Strzyżenie, farbowanie, upięcia okolicznościowe.',
    services: [
      { name: 'Strzyżenie', description: 'Damskie i męskie strzyżenie z modelowaniem' },
      { name: 'Koloryzacja', description: 'Farbowanie, baleyage, ombre' },
      { name: 'Stylizacja', description: 'Upięcia ślubne i okolicznościowe' },
    ],
  },
];

// find slugs that produce exact layout×style combos
function findSlug(category: string, layoutIdx: number, styleIdx: number): string {
  const targetLayout = LAYOUTS[layoutIdx];
  const targetStyle = STYLES[styleIdx];
  for (let n = 0; n < 10000; n++) {
    const slug = `test-${category}-${n}`;
    if (pickLayout(slug) === targetLayout && pickStyle(slug) === targetStyle) return slug;
  }
  throw new Error(`no slug for ${category}/${targetLayout}/${targetStyle}`);
}

// locality
sql(`INSERT OR IGNORE INTO localities (id, name, slug, sym) VALUES (9999, 'Testowo', 'testowo', '0000001')`);

const urls: string[] = [];
let bizId = 1000;

for (const cat of CATEGORIES) {
  for (let li = 0; li < 3; li++) {
    for (let si = 0; si < 3; si++) {
      const slug = findSlug(cat.category, li, si);
      const layout = LAYOUTS[li];
      const style = STYLES[si];
      bizId++;

      sql(`INSERT OR IGNORE INTO businesses (id, locality_id, place_id, title, slug, phone, address, category, rating, gps_lat, gps_lng, site_generated) VALUES (${bizId}, 9999, 'test-${bizId}', '${cat.title.replace(/'/g, "''")}', '${slug}', '+48 500 000 ${String(bizId).padStart(3, '0')}', 'ul. Testowa 1, 00-001 Testowo', '${cat.category}', 4.5, 52.0, 17.0, 1)`);

      const siteData = {
        hero: { headline: cat.headline, subheadline: cat.sub },
        about: { title: 'O nas', text: cat.about },
        services: cat.services,
        contact: { cta_text: 'Zadzwoń', phone: `+48 500 000 ${String(bizId).padStart(3, '0')}`, address: 'ul. Testowa 1, 00-001 Testowo' },
        seo: { title: `${cat.title} — ${layout}/${style}`, description: `Test: ${cat.logoKey} logo, ${layout} layout, ${style} style` },
      };

      r2put(`sites/testowo/${slug}.json`, JSON.stringify(siteData));
      urls.push(`  ${layout.padEnd(8)} ${style.padEnd(7)} ${cat.logoKey.padEnd(20)} http://localhost:8787/testowo/${slug}`);
    }
  }
}

console.log(`\n✓ Seeded ${urls.length} test businesses (${CATEGORIES.length} logos × 9 layout/style combos)\n`);
console.log('Layout   Style   Logo                 URL');
console.log('─'.repeat(100));
for (const u of urls) console.log(u);
