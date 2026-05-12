# Canvas Curator — Complete EdPlus Design System Implementation

## Executive Summary

The Canvas Curator frontend has been fully updated to the **ASU EdPlus Design System**. This includes:

✅ Complete color token refresh (maroon + gold + neutral grays)  
✅ Typography system aligned (Neue Haas Grotesk with Inter Tight fallback)  
✅ Standardized spacing, shadows, and border radius  
✅ Reusable component library (Button, Input, Card, Modal, Badge, Alert, Divider)  
✅ Interactive storybook page showcasing all components  
✅ Migration guide for updating existing components  
✅ Design system documentation and visual guides  

---

## What Was Updated

### 1. Design Tokens (`globals.css`)
**Colors:** Switched from blue-tinted surfaces to true EdPlus maroon (#8C1D40), gold (#FFC627), and neutral grays.

**Typography:** 
- Display font: Neue Haas Grotesk Display Pro (Inter Tight fallback)
- Body font: Neue Haas Grotesk Text Pro (Inter Tight fallback)
- All text uses -0.02em letter-spacing by default

**Spacing:** 8px grid system (space-1: 4px through space-10: 128px)

**Radii:** Standardized scale (4px, 8px, 12px, 16px, 24px, 999px)

**Shadows:** EdPlus subtle elevation tokens

### 2. Core Components Updated
- **AppHeader** — Refined styling, colors, font weights
- **SideNav** — Updated navigation styling, active states
- **Layout** — Font imports aligned to EdPlus spec

### 3. New Component Library (`frontend/src/components/edplus/`)
```
edplus/
├── Button.tsx          (primary, secondary, ghost, destructive)
├── Input.tsx           (with labels, hints, error states, icons)
├── Card.tsx            (Card, CardHeader, CardBody, CardFooter)
├── Modal.tsx           (Modal, ModalBody, ModalFooter)
├── Badge.tsx           (5 variants)
├── Alert.tsx           (info, success, warning, error)
├── Divider.tsx         (horizontal/vertical/labeled)
└── index.ts            (exports)
```

### 4. Showcase Page (`/edplus-components`)
Interactive storybook demonstrating:
- All button variants and sizes
- Form inputs with various states
- Card layouts and patterns
- Modal dialogs
- Badges and alerts
- Dividers
- Design guidelines

---

## How to Use

### Using the New Component Library

**Buttons:**
```tsx
import Button from "@/components/edplus/Button";

<Button variant="primary" size="md" loading={isLoading}>
  Save Changes
</Button>
```

**Form Inputs:**
```tsx
import Input from "@/components/edplus/Input";

<Input
  label="Email"
  type="email"
  error={emailError}
  hint="Optional hint text"
  fullWidth
/>
```

**Cards:**
```tsx
import Card, { CardHeader, CardBody, CardFooter } from "@/components/edplus/Card";

<Card elevated>
  <CardHeader><h3>Title</h3></CardHeader>
  <CardBody>Content</CardBody>
  <CardFooter>
    <Button>Cancel</Button>
    <Button variant="primary">Save</Button>
  </CardFooter>
</Card>
```

**Modals:**
```tsx
import Modal, { ModalBody, ModalFooter } from "@/components/edplus/Modal";

<Modal open={open} onOpenChange={setOpen} title="Dialog">
  <ModalBody>Content</ModalBody>
  <ModalFooter>
    <Button>Cancel</Button>
    <Button variant="primary">Confirm</Button>
  </ModalFooter>
</Modal>
```

### CSS Classes (Still Available)
If you need to style custom elements, use EdPlus CSS variables:

```css
.my-custom-element {
  background: var(--color-primary);
  color: var(--color-on-primary);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  font-family: var(--font-body);
  letter-spacing: var(--tracking-tight);
}
```

---

## Design System Colors

### Brand Colors
| Name | Hex | Usage |
|------|-----|-------|
| **ASU Maroon** | #8C1D40 | Primary CTAs, active states, headlines |
| **ASU Gold** | #FFC627 | Secondary actions, accents, highlights |

### Text Colors
| Name | Hex | Usage |
|------|-----|-------|
| **Primary Text** | #191919 | Body copy, headlines |
| **Secondary Text** | #6F6F6F | Labels, secondary info |
| **Tertiary Text** | #8C8C8C | Metadata, eyebrows |

### Neutral Backgrounds
| Name | Hex | Usage |
|------|-----|-------|
| **Surface** | #FFFFFF | Page background |
| **Container Low** | #FAFAFA | Subtle fills (sidebars, sections) |
| **Container Lowest** | #FFFFFF | Cards, modals |

### Borders & Rules
| Name | Hex | Usage |
|------|-----|-------|
| **Outline** | #D0D0D0 | Strong dividers |
| **Outline Variant** | #EFEFEF | Light hairlines |

---

## Component Variants & Options

### Buttons
**Variants:** `primary` | `secondary` | `ghost` | `destructive`  
**Sizes:** `sm` (9px) | `md` (10px, default) | `lg` (12px)  
**Props:** `variant`, `size`, `loading`, `icon`, `disabled`, `className`

### Inputs
**Props:** `label`, `error`, `hint`, `icon`, `fullWidth`, `type`, `placeholder`, `disabled`, `className`

### Cards
**Props:** `elevated` (adds shadow), `interactive` (hover effect), `className`  
**Subcomponents:** `CardHeader`, `CardBody`, `CardFooter`

### Modals
**Sizes:** `sm` | `md` | `lg`  
**Props:** `open`, `onOpenChange`, `title`, `subtitle`, `size`  
**Subcomponents:** `ModalBody`, `ModalFooter`

### Badges
**Variants:** `default` | `primary` | `success` | `warning` | `error`

### Alerts
**Variants:** `info` | `success` | `warning` | `error`  
**Props:** `variant`, `title`, `onClose`, `children`

### Divider
**Props:** `orientation` ("horizontal" | "vertical"), `children` (label)

---

## Files & Documentation

### Core Files
- `frontend/src/app/globals.css` — All EdPlus design tokens
- `frontend/src/app/layout.tsx` — Font setup
- `frontend/src/components/ui/AppHeader.tsx` — Updated header
- `frontend/src/components/ui/SideNav.tsx` — Updated nav
- `frontend/src/components/edplus/*` — Component library

### Documentation
- **DESIGN_SYSTEM_UPDATES.md** — Detailed changelog with before/after comparison
- **DESIGN_UPDATES_VISUAL_GUIDE.html** — Interactive color, type, and component reference
- **COMPONENT_MIGRATION_GUIDE.md** — Step-by-step guide for updating components
- **README.md** (this file) — Complete implementation overview

### Design Assets
- `assets/logos/` — ASU, ASU Online, EdPlus brand marks
- `assets/icons/` — Heroicons outline set + ASU discipline icons
- `colors_and_type.css` — EdPlus token reference

### Showcase
- `/edplus-components` page — Interactive component storybook

---

## Next Steps

### Immediate (This Sprint)
- [x] Update color and typography tokens
- [x] Create reusable component library
- [x] Build component showcase page
- [x] Document migration guide

### Short-term (Next Sprint)
- [ ] Migrate CreateModuleButton, CreateContentItemButton
- [ ] Migrate form dialogs (DocumentDetailManager, etc.)
- [ ] Update InventoryTable with new Button + Alert components
- [ ] Audit and fix accessibility (focus rings, contrast, ARIA)

### Medium-term
- [ ] Complete component library migration (all ~20 UI components)
- [ ] License and integrate Neue Haas Grotesk fonts
- [ ] Create form component patterns (FormField, FormError, etc.)
- [ ] Add animation/transition library consistent with EdPlus
- [ ] Build dashboard layouts following EdPlus card patterns

### Long-term
- [ ] Comprehensive design system documentation site
- [ ] Figma component library sync
- [ ] Design/dev handoff automation
- [ ] Version control for design tokens

---

## EdPlus Design Principles

### Tone & Voice
- **Declarative, mission-forward, institutional**
- No emoji, no exclamation points
- Lead with impact statements and numbers
- First-person plural ("we", "our")
- Curly quotes, em-dashes for emphasis

### Visual Language
- **Maroon & gold** — Bold institutional branding
- **White backgrounds** — Clean, spacious layouts
- **Generous spacing** — Breathing room between elements
- **Subtle shadows** — Elevation, not neon glow
- **Tight letter-spacing** — Sophisticated, compact typography
- **No gradients, patterns, or textures** — Flat, institutional

### Component Patterns
- **Consistent corner radius** — 12px default for most UI
- **Smooth transitions** — 150ms cubic-bezier(0.2, 0.8, 0.2, 1)
- **Hairline borders** — Light gray (#EFEFEF) for subtle definition
- **Icon consistency** — Heroicons outline set + ASU discipline icons
- **Focus states** — Visible rings, accessible keyboard navigation

---

## Troubleshooting

### Components look different in preview
- Ensure `globals.css` is imported in `layout.tsx`
- Check that no `@tailwindcss` overrides are conflicting
- Verify color variables are defined (check `:root` in `globals.css`)

### Font looks wrong
- Inter Tight is the current fallback (Google Fonts)
- When Neue Haas Grotesk is licensed, update `@font-face` in `colors_and_type.css`
- Component code doesn't need changes — fallback stack handles it automatically

### Components won't compile
- Verify imports: `import Button from "@/components/edplus/Button";`
- Check that component files exist in `frontend/src/components/edplus/`
- Ensure TypeScript definitions are correct

### Spacing feels off
- Use EdPlus spacing scale: `gap-2` (8px), `gap-3` (12px), `gap-4` (16px), etc.
- Avoid mixing with other spacing systems
- Verify `globals.css` space variables are loaded

---

## Reference Resources

### Internal
- Full EdPlus Design System project: `/projects/019ddac9-d351-7672-875b-b7b2eedd58cd/`
- Component showcase: `frontend/src/app/edplus-components/page.tsx`
- Migration examples: `COMPONENT_MIGRATION_GUIDE.md`

### External
- ASU Official: https://www.asu.edu
- ASU Online: https://asuonline.asu.edu
- EdPlus: https://edplus.asu.edu

### Icon Sources
- Heroicons: https://heroicons.com (outline v2)
- Font Awesome Light: https://fontawesome.com (fallback for specialized icons)

---

## Contact & Questions

For questions about:
- **Component usage** — Check `/edplus-components` showcase
- **Design decisions** — See `DESIGN_SYSTEM_UPDATES.md`
- **Migrating components** — Follow `COMPONENT_MIGRATION_GUIDE.md`
- **EdPlus standards** — Reference full system at `/projects/019ddac9-d351-7672-875b-b7b2eedd58cd/`

---

**Last Updated:** May 8, 2026  
**Version:** 1.0 (Initial implementation)  
**Status:** ✅ Ready for component migration
