/**
 * Seed local D1 + R2 with a few test businesses for visual testing.
 * Usage: pnpm tsx scripts/seed-local-test.ts
 * Then: pnpm preview → http://localhost:8787/wybranowo/uslugi-elektryczne-skoki-pawel-bialy
 */
import { execSync } from 'node:child_process';

function sql(cmd: string) {
  const escaped = cmd.replace(/'/g, "'\\''");
  execSync(`pnpm wrangler d1 execute leadgen --local --command '${escaped}'`, { stdio: 'inherit' });
}

function r2put(key: string, body: string) {
  execSync(`echo '${body.replace(/'/g, "'\\''")}' | pnpm wrangler r2 object put "sites/${key}" --local --pipe`, { stdio: 'inherit' });
}

// locality
sql(`INSERT OR IGNORE INTO localities (id, name, slug, sym) VALUES (6867, 'Wybranowo', 'wybranowo', '0987654')`);

// businesses
const businesses = [
  { id: 7, place_id: 'ChIJYQgtXi97BEcRSR4RjGeTYyk', slug: 'uslugi-elektryczne-skoki-pawel-bialy', title: 'Usługi Elektryczne Skoki. Paweł Biały', category: 'elektryk', address: 'Parkowa 5, 62-085 Skoki, Poland', phone: '+48 61 812 44 66', rating: 3.8, lat: 52.6723, lng: 17.1529 },
  { id: 8, place_id: 'ChIJ-RdSnSh7BEcRGl4vUerF00U', slug: 'wojtkowiak-tomasz-zaklad-instalacji-elektrycznych', title: 'Wojtkowiak Tomasz. Zakład instalacji elektrycznych', category: 'elektryk', address: 'Krańcowa 2, 62-085 Skoki, Poland', phone: '+48 61 812 43 03', rating: 5.0, lat: 52.6731, lng: 17.1483 },
  { id: 17, place_id: 'ChIJ56OzmUN7BEcRj4gEzjbnApI', slug: 'raf-car-okregowa-stacja-kontroli-pojazdow', title: 'RAF-CAR Okręgowa Stacja Kontroli Pojazdów', category: 'mechanik', address: 'Parkowa 17A, 62-085 Skoki, Poland', phone: '+48 533 272 402', rating: 4.6, lat: 52.6750, lng: 17.1489 },
  { id: 19, place_id: 'ChIJKRt_Izd7BEcROxZbk72iVTA', slug: 'auto-plutek-wulkanizacja-mobilna-24h-i-stacjonarna', title: 'Auto Plutek Wulkanizacja Mobilna 24H i Stacjonarna', category: 'mechanik', address: 'Antoniewska 10, 62-085 Skoki, Poland', phone: '+48 693 590 426', rating: 4.8, lat: 52.6676, lng: 17.1697 },
];

for (const b of businesses) {
  sql(`INSERT OR IGNORE INTO businesses (id, locality_id, place_id, title, slug, phone, address, category, rating, gps_lat, gps_lng, site_generated) VALUES (${b.id}, 6867, '${b.place_id}', '${b.title.replace(/'/g, "''")}', '${b.slug}', '${b.phone}', '${b.address.replace(/'/g, "''")}', '${b.category}', ${b.rating}, ${b.lat}, ${b.lng}, 1)`);
}

// site JSONs
const siteTemplates: Record<string, object> = {
  'uslugi-elektryczne-skoki-pawel-bialy': {
    hero: { headline: 'Profesjonalne usługi elektryczne w Skokach', subheadline: 'Doświadczony elektryk z wieloletnim stażem' },
    about: { title: 'O firmie', text: 'Firma Usługi Elektryczne Skoki specjalizuje się w kompleksowych instalacjach elektrycznych dla domów i firm. Działamy na terenie Skoków i okolic, oferując fachową obsługę i konkurencyjne ceny.' },
    services: [
      { name: 'Instalacje elektryczne', description: 'Kompleksowe wykonanie instalacji w nowych budynkach' },
      { name: 'Modernizacja instalacji', description: 'Wymiana starych instalacji na nowoczesne rozwiązania' },
      { name: 'Pomiary elektryczne', description: 'Okresowe przeglądy i pomiary instalacji' },
      { name: 'Awarie 24h', description: 'Szybka pomoc w nagłych awariach elektrycznych' },
    ],
    contact: { cta_text: 'Zadzwoń teraz', phone: '+48 61 812 44 66', address: 'Parkowa 5, 62-085 Skoki' },
    seo: { title: 'Usługi Elektryczne Skoki - Paweł Biały', description: 'Profesjonalne usługi elektryczne w Skokach. Instalacje, modernizacje, pomiary i naprawy awaryjne.' },
    theme: 'slate',
  },
  'wojtkowiak-tomasz-zaklad-instalacji-elektrycznych': {
    hero: { headline: 'Zakład Instalacji Elektrycznych Wojtkowiak', subheadline: 'Solidność i precyzja w każdym zleceniu' },
    about: { title: 'O nas', text: 'Zakład Instalacji Elektrycznych Tomasz Wojtkowiak działa od ponad 20 lat na rynku usług elektrycznych. Specjalizujemy się w instalacjach mieszkaniowych i przemysłowych.' },
    services: [
      { name: 'Instalacje mieszkaniowe', description: 'Pełne okablowanie domów i mieszkań' },
      { name: 'Instalacje przemysłowe', description: 'Rozwiązania dla hal produkcyjnych i magazynów' },
      { name: 'Oświetlenie LED', description: 'Projektowanie i montaż nowoczesnego oświetlenia' },
    ],
    contact: { cta_text: 'Umów wizytę', phone: '+48 61 812 43 03', address: 'Krańcowa 2, 62-085 Skoki' },
    seo: { title: 'Wojtkowiak - Instalacje Elektryczne Skoki', description: 'Zakład instalacji elektrycznych w Skokach. Ponad 20 lat doświadczenia w branży.' },
    theme: 'ocean',
  },
  'raf-car-okregowa-stacja-kontroli-pojazdow': {
    hero: { headline: 'RAF-CAR Stacja Kontroli Pojazdów', subheadline: 'Szybki i rzetelny przegląd techniczny' },
    about: { title: 'O stacji', text: 'Okręgowa Stacja Kontroli Pojazdów RAF-CAR w Skokach oferuje profesjonalne przeglądy techniczne wszystkich typów pojazdów. Nowoczesne wyposażenie diagnostyczne.' },
    services: [
      { name: 'Przeglądy osobowe', description: 'Badania techniczne samochodów osobowych' },
      { name: 'Przeglądy dostawcze', description: 'Kontrola pojazdów dostawczych i ciężarowych' },
      { name: 'Badania dodatkowe', description: 'Badania po zmianach konstrukcyjnych i GAZ/LPG' },
      { name: 'Diagnostyka komputerowa', description: 'Zaawansowana diagnostyka usterek' },
    ],
    contact: { cta_text: 'Zadzwoń i umów', phone: '+48 533 272 402', address: 'Parkowa 17A, 62-085 Skoki' },
    seo: { title: 'RAF-CAR Stacja Kontroli Pojazdów Skoki', description: 'Okręgowa stacja kontroli pojazdów w Skokach. Przeglądy techniczne i diagnostyka.' },
    theme: 'earth',
  },
  'auto-plutek-wulkanizacja-mobilna-24h-i-stacjonarna': {
    hero: { headline: 'Auto Plutek - Wulkanizacja 24H', subheadline: 'Mobilna i stacjonarna wymiana opon' },
    about: { title: 'O firmie', text: 'Auto Plutek to wulkanizacja mobilna dostępna 24 godziny na dobę oraz stacjonarny serwis opon. Dojeżdżamy na miejsce awarii w promieniu 50 km od Skoków.' },
    services: [
      { name: 'Wulkanizacja mobilna 24h', description: 'Naprawa i wymiana opon w dowolnym miejscu, o każdej porze' },
      { name: 'Wymiana opon', description: 'Sezonowa wymiana opon osobowych i dostawczych' },
      { name: 'Wyważanie kół', description: 'Precyzyjne wyważanie na nowoczesnej wyważarce' },
      { name: 'Naprawa opon', description: 'Łatanie przebitych opon i naprawa uszkodzeń' },
    ],
    contact: { cta_text: 'Zadzwoń - jedziemy!', phone: '+48 693 590 426', address: 'Antoniewska 10, 62-085 Skoki' },
    seo: { title: 'Auto Plutek Wulkanizacja Mobilna 24H Skoki', description: 'Wulkanizacja mobilna 24h i stacjonarna w Skokach. Wymiana opon, wyważanie, naprawy.' },
    theme: 'crimson',
  },
};

for (const [slug, data] of Object.entries(siteTemplates)) {
  const key = `sites/wybranowo/${slug}.json`;
  const json = JSON.stringify(data);
  r2put(key, json);
  console.log(`R2: ${key}`);
}

// seller
sql(`INSERT OR IGNORE INTO sellers (id, name, token) VALUES (1, 'Jan Testowy', 'test-seller-token-1234')`);

// call_log — 2 businesses with varied statuses
sql(`INSERT OR IGNORE INTO call_log (id, business_id, seller_id, status, comment) VALUES (1, 7, 1, 'called', 'nie odbieral')`);
sql(`INSERT OR IGNORE INTO call_log (id, business_id, seller_id, status, comment) VALUES (2, 8, 1, 'interested', 'chce wiedziec wiecej')`);

console.log('\nDone! Test URLs:');
for (const b of businesses) {
  console.log(`  http://localhost:8787/wybranowo/${b.slug}`);
}
console.log(`  http://localhost:8787/s/test-seller-token-1234?status=all (seller panel)`);
