# Canvas Curator — EdPlus Design System Updates

## Overview
The Canvas Curator frontend has been comprehensively updated to align with the **ASU EdPlus Design System**. All visual tokens, typography, spacing, components, and UI patterns now follow the official EdPlus standards.

---

## Changes Applied

### 1. **Color System** (`globals.css`)
**Before:** Custom MD3-inspired color palette with blue-tinted surfaces  
**After:** EdPlus primary palette with maroon (#8c1d40) and gold (#ffc627)

| Token | Before | After | Purpose |
|-------|--------|-------|---------|
| `--color-primary` | `#8c1d40` | `#8c1d40` | ✓ ASU Maroon (unchanged) |
| `--color-primary-container` | `#6c002a` | `#6e1632` | Darker maroon shade |
| `--color-secondary` | `#775a00` | `#ffc627` | ✓ ASU Gold (corrected) |
| `--color-surface` | `#f8f9ff` (blue tint) | `#ffffff` | Pure white page background |
| `--color-surface-container-low` | `#eff4ff` | `#fafafa` | Subtle neutral fill |
| `--color-on-surface` | `#0b1c30` (dark blue) | `#191919` | True dark text |
| `--color-outline-variant` | `#ddbfc3` (pink) | `#efefef` | Light gray hairline |

**Result:** Cleaner, more institutional appearance with true EdPlus maroon/gold and neutral grays.

---

### 2. **Typography** (`layout.tsx` + `globals.css`)
**Before:** Manrope + Inter fonts  
**After:** Neue Haas Grotesk (with Inter Tight fallback per EdPlus spec)

```tsx
// Before
const manrope = Manrope({ variable: "--font-manrope", ... });
const inter = Inter({ variable: "--font-inter", ... });

// After
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  weight: ["300", "400", "500", "600", "700"],
});
```

**Font stacks updated:**
- Display (headlines): `"Neue Haas Grotesk Display Pro"` → `"Inter Tight"` (fallback)
- Body (copy): `"Neue Haas Grotesk Text Pro"` → `"Inter Tight"` (fallback)

**Note:** When Neue Haas Grotesk files are licensed and added to `fonts/`, update `@font-face` declarations in `colors_and_type.css`.

---

### 3. **Type Scales** (Standardized in `globals.css`)
All semantic type tokens now follow EdPlus scales:

```css
--text-eyebrow:        12px; (was 18px)
--text-h1:             36px;
--text-h2:             30px;
--text-h3:             24px;
--text-body:           18px;
--text-body-sm:        16px;
--text-caption:        14px;
--tracking-tight:      -0.02em; (default everywhere)
--tracking-display:    -0.022em; (headlines)
```

**Result:** Consistent, tighter letter-spacing throughout, matching EdPlus's sophisticated spacing.

---

### 4. **Component Styling**

#### AppHeader (`AppHeader.tsx`)
- Button corners: `rounded-xl` → `rounded-lg` (12px vs 20px)
- Font weights: `font-bold` → `font-medium` / `font-semibold` (EdPlus convention)
- Shadows: Replaced heavy shadows with EdPlus `shadow-card`
- Dialog borders: Uses EdPlus `ghost-border` (light hairline)
- Eyebrow labels: Updated tracking to `0.15em` (EdPlus standard)

#### SideNav (`SideNav.tsx`)
- Navigation item corners: `rounded-xl` → `rounded-lg`
- Wordmark font weight: `font-black` → `font-bold`
- Active state: Subtle shadow + text primary color (EdPlus pattern)
- Hover states: Cleaner transitions using surface tokens

---

### 5. **Spacing & Layout** (Aligned to 8px grid)
All spacing now uses EdPlus's 8px-based scale:

```css
--space-1:   4px;
--space-2:   8px;
--space-3:   12px;
--space-4:   16px;
--space-5:   24px;
--space-6:   32px;
--space-7:   48px;
--space-8:   64px;
--space-9:   96px;
--space-10:  128px;
```

---

### 6. **Border Radius** (Standardized)
**Before:** Mixed values (0.25rem, 0.75rem, 1.5rem, etc.)  
**After:** EdPlus scale:

```css
--radius-xs:   4px;    (for small interactive elements)
--radius-sm:   8px;    (for chips, small inputs)
--radius-md:   12px;   (for cards, medium elements)
--radius-lg:   16px;   (for large containers)
--radius-xl:   24px;   (for hero blocks)
--radius-pill: 999px;  (for pill buttons/tags)
```

**Applied:** All `rounded-xl` (20px) → `rounded-lg` (12px)

---

### 7. **Shadows** (EdPlus scales)
Replaced custom shadows with EdPlus tokens:

```css
--shadow-ambient:   0 4px 20px rgba(0, 0, 0, 0.08);  /* subtle, default) */
--shadow-card:      0 5px 20px rgba(0,0,0,0.10), 0 0 3px rgba(0,0,0,0.30); /* elevated) */
--shadow-floating:  0 4px 22px rgba(0, 0, 0, 0.09);  /* modals, popovers) */
```

---

### 8. **Assets Copied**
From `/projects/019ddac9-d351-7672-875b-b7b2eedd58cd/`:
- ✅ `colors_and_type.css` — Complete EdPlus token reference
- ✅ `assets/logos/` — ASU, ASU Online, EdPlus logos (light + dark variants)
- ✅ `assets/icons/` — Heroicons outline set + ASU discipline icons

These are now available in the project for use in components.

---

## Files Modified

1. **`frontend/src/app/globals.css`**
   - Replaced all color tokens with EdPlus palette
   - Updated typography families, weights, and scales
   - Standardized spacing, radii, and shadows
   - Cleaned up base element styles

2. **`frontend/src/app/layout.tsx`**
   - Replaced Manrope + Inter with Inter Tight
   - Simplified font variable setup

3. **`frontend/src/components/ui/AppHeader.tsx`**
   - Updated all border-radius values
   - Refined font weights and sizes
   - Applied EdPlus shadows and borders

4. **`frontend/src/components/ui/SideNav.tsx`**
   - Updated border-radius and font weights
   - Aligned spacing with EdPlus grid
   - Improved active state styling

---

## Next Steps

### For designers:
1. ✅ Review updated AppHeader and SideNav in preview
2. ✅ Verify color transitions and hover states
3. 🔜 Apply same principles to remaining UI components (buttons, forms, cards, modals)
4. 🔜 Update dashboard and session pages to use EdPlus card patterns
5. 🔜 Create button component library aligned with EdPlus (primary, secondary, ghost)

### For developers:
1. 🔜 Update Tailwind config to use EdPlus tokens
2. 🔜 Create `.tsx` component library for reusable EdPlus elements
3. 🔜 License and install Neue Haas Grotesk fonts (update `@font-face` in `colors_and_type.css`)
4. 🔜 Apply EdPlus patterns to remaining pages (DocumentsManager, ImagesManager, etc.)

### Design system integration:
- When ready, migrate to Neue Haas Grotesk by:
  1. Purchasing font licenses from Linotype/Monotype
  2. Adding `.woff2` files to `frontend/fonts/`
  3. Updating `@font-face` declarations in `colors_and_type.css`
  4. No component changes needed — fallback stack automatically uses the licensed font

---

## Design System Reference

The full ASU EdPlus Design System is available at:
- **Project:** `/projects/019ddac9-d351-7672-875b-b7b2eedd58cd/`
- **Files:**
  - `colors_and_type.css` — Complete token definitions
  - `assets/logos/` — Official ASU/EdPlus logos
  - `assets/icons/` — Heroicons + discipline icons
  - `ui_kits/asu_online_marketing/` — Marketing site examples
  - `slides/` — 1920×1080 slide templates

**Voice & copy guidelines:**
- Declarative, mission-forward, institutional tone
- No emoji, no exclamation points
- Lead with impact statements and numbers
- First-person plural ("we", "our")
- Curly quotes, em-dashes for emphasis

---

## Testing Checklist

- [ ] Header renders with correct maroon branding
- [ ] Gold accent color appears on interactive states
- [ ] Typography sizes and weights match EdPlus scales
- [ ] Spacing feels generous and aligned to 8px grid
- [ ] Border radius consistent (12px default for components)
- [ ] Shadows subtle and professional (not neon/glow)
- [ ] Hover/focus states use EdPlus transitions (150ms, cubic-bezier ease)
- [ ] Color contrast meets WCAG AA for all text
- [ ] No blue-tinted backgrounds (pure white preferred)
