import type { SiteData } from '../types/site';
import { callGLM5, validateSiteData } from './generator';
import type { GLMMessage } from './generator';

const EDIT_SYSTEM_PROMPT = `Jestes asystentem edycji wizytowek firmowych.
Otrzymujesz obecny JSON wizytowki i instrukcje od wlasciciela firmy.
Zwroc CALY zaktualizowany JSON z naniesionymi zmianami.
Odpowiedz TYLKO JSON, bez markdown, bez komentarzy.

Dozwolone edycje:
- Dodawanie/edycja/usuwanie uslug (services)
- Zmiana godzin pracy (w about.text lub contact)
- Zmiana adresu (contact.address)
- Edycja opisu firmy (about.text, hero)

NIE WOLNO zmieniac:
- Numeru telefonu (contact.phone)
- Motywu (theme)

Jesli instrukcja jest niejasna, zrob najlepsza interpretacje.
Jesli instrukcja jest poza dozwolonym zakresem, zwroc oryginalny JSON bez zmian.`;

export async function patchSiteData(
  env: Env,
  currentSite: SiteData,
  instruction: string
): Promise<SiteData> {
  const messages: GLMMessage[] = [
    { role: 'system', content: EDIT_SYSTEM_PROMPT },
    { role: 'user', content: `Obecna wizytowka:\n${JSON.stringify(currentSite, null, 2)}\n\nInstrukcja: ${instruction}` },
  ];

  const raw = await callGLM5(messages, env.ZAI_API_KEY);
  const patched = validateSiteData(raw);

  patched.contact.phone = currentSite.contact.phone;
  patched.theme = currentSite.theme;

  return patched;
}

export function summarizeChanges(old: SiteData, updated: SiteData): string {
  const changes: string[] = [];

  if (old.hero.headline !== updated.hero.headline)
    changes.push(`Naglowek: "${updated.hero.headline}"`);
  if (old.about.text !== updated.about.text)
    changes.push('Opis firmy: zmieniony');
  if (old.contact.address !== updated.contact.address)
    changes.push(`Adres: "${updated.contact.address}"`);

  const oldNames = old.services.map(s => s.name);
  const newNames = updated.services.map(s => s.name);
  const added = newNames.filter(n => !oldNames.includes(n));
  const removed = oldNames.filter(n => !newNames.includes(n));
  if (added.length) changes.push(`Nowe uslugi: ${added.join(', ')}`);
  if (removed.length) changes.push(`Usuniete uslugi: ${removed.join(', ')}`);

  return changes.length ? changes.join('\n') : 'Brak widocznych zmian';
}
