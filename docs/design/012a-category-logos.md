# DD-012a: Category SVG Logos

## Overview

Add category-based SVG logos to business card layouts. Logos use `currentColor`/CSS vars — auto-match palette + dark mode.

## Goals

- 10 SVG icons mapped to business categories
- Responsive sizing per style variant
- Integration with all 3 layouts

## Non-Goals

- Individual/unique logos per business
- Logo generation pipeline (manual SVG files for now)
- Logo customization by owners

---

## Files

### SVG assets: `src/assets/logos/`

| File | Categories |
|------|-----------|
| `warm-food.svg` | restauracja, piekarnia, cukiernia |
| `warm-cafe.svg` | kawiarnia |
| `warm-florist.svg` | kwiaciarnia |
| `clinical-medical.svg` | lekarz, dentysta, fizjoterapia |
| `clinical-vet.svg` | weterynarz |
| `clinical-pharmacy.svg` | apteka |
| `industrial-mechanic.svg` | mechanik, warsztat |
| `industrial-plumber.svg` | hydraulik |
| `industrial-electric.svg` | elektryk |
| `default.svg` | fallback |

All SVGs: `viewBox="0 0 64 64"`, single-color `currentColor`, 2px stroke, no gradients/filters.

---

## Implementation

### 1. New component: `src/components/CategoryLogo.astro`

Props:
```typescript
interface Props {
  category: string;
  class?: string;
}
```

Logic:
- Map `category` → SVG file using lookup (reuse `CATEGORY_MAP` groups from `themes.ts`)
- Import all 10 SVGs statically
- Render inline `<svg>` with `class` pass-through
- Color via `color: var(--color-hero-accent)` (inherits from parent)

Category → file mapping:
```typescript
const LOGO_MAP: Record<string, string> = {
  restauracja: 'warm-food',
  piekarnia: 'warm-food',
  cukiernia: 'warm-food',
  kawiarnia: 'warm-cafe',
  kwiaciarnia: 'warm-florist',
  dentysta: 'clinical-medical',
  lekarz: 'clinical-medical',
  fizjoterapia: 'clinical-medical',
  weterynarz: 'clinical-vet',
  apteka: 'clinical-pharmacy',
  mechanik: 'industrial-mechanic',
  warsztat: 'industrial-mechanic',
  hydraulik: 'industrial-plumber',
  elektryk: 'industrial-electric',
};
// fallback → 'default'
```

### 2. Layout integration

#### CenteredLayout
- Logo centered above headline in hero section
- `mx-auto mb-6`

#### SplitLayout
- Logo in right column (alongside CTA area) in hero flex row
- `md:w-1/3` column, logo centered within

#### MinimalLayout
- Small logo inline-left of hero title
- `inline-flex items-center gap-3`

### 3. Responsive sizing via style variant

Add to `base.css` under each `[data-style]`:

```css
[data-style="modern"] .logo-icon {
  width: 3rem;    /* 48px */
  height: 3rem;
  opacity: 0.8;
}
@media (min-width: 768px) {
  [data-style="modern"] .logo-icon {
    width: 4rem;  /* 64px */
    height: 4rem;
  }
}

[data-style="elegant"] .logo-icon {
  width: 3.5rem;  /* 56px */
  height: 3.5rem;
  opacity: 0.7;
}
@media (min-width: 768px) {
  [data-style="elegant"] .logo-icon {
    width: 4.5rem; /* 72px */
    height: 4.5rem;
  }
}

[data-style="bold"] .logo-icon {
  width: 4.5rem;  /* 72px */
  height: 4.5rem;
}
@media (min-width: 768px) {
  [data-style="bold"] .logo-icon {
    width: 6rem;   /* 96px */
    height: 6rem;
  }
}
```

### 4. Color inheritance

SVGs use `currentColor`. Parent element sets:
```css
color: var(--color-hero-accent);
```

Dark mode works automatically — palette's dark variant supplies different `--color-hero-accent`.

---

## Files touched

| File | Change |
|------|--------|
| `src/components/CategoryLogo.astro` | **NEW** — category→SVG resolver + inline render |
| `src/components/layouts/CenteredLayout.astro` | Add `<CategoryLogo>` above hero headline |
| `src/components/layouts/SplitLayout.astro` | Add `<CategoryLogo>` in hero right column |
| `src/components/layouts/MinimalLayout.astro` | Add `<CategoryLogo>` inline with title |
| `src/styles/base.css` | `.logo-icon` sizing rules per `[data-style]` |
| `src/components/BusinessSite.astro` | Pass `category` prop to layout components |
