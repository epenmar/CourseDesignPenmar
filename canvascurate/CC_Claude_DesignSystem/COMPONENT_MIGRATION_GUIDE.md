# EdPlus Component Library Migration Guide

## Overview
The Canvas Curator frontend now includes a unified, reusable component library built on the ASU EdPlus Design System. This guide helps you migrate existing components to use the new library.

## Component Library Location
All new EdPlus components are in: `frontend/src/components/edplus/`

### Available Components
- **Button** — Primary, secondary, ghost, and destructive variants
- **Input** — Form inputs with labels, hints, and error states
- **Card** — Containers with CardHeader, CardBody, CardFooter
- **Modal** — Dialog windows with ModalBody, ModalFooter
- **Badge** — Compact status labels
- **Alert** — Informational, success, warning, and error messages
- **Divider** — Visual separators (horizontal or vertical)

## Import Examples

### Before (Inline styling)
```tsx
<button className="rounded-xl px-5 py-2.5 bg-primary text-on-primary font-bold hover:opacity-90">
  Create Module
</button>
```

### After (Component library)
```tsx
import Button from "@/components/edplus/Button";

<Button variant="primary" size="md">
  Create Module
</Button>
```

---

## Migration Examples by Component Type

### Buttons

**Before:**
```tsx
<button className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40">
  Save Changes
</button>
```

**After:**
```tsx
import Button from "@/components/edplus/Button";

<Button variant="primary" size="md" loading={isSaving}>
  Save Changes
</Button>
```

**Variant options:**
- `variant="primary"` — Main CTA (maroon background)
- `variant="secondary"` — Gold background
- `variant="ghost"` — Border-only style
- `variant="destructive"` — Red/error color

**Size options:**
- `size="sm"` — Compact (9px height)
- `size="md"` — Standard (10px height, default)
- `size="lg"` — Large (12px height)

---

### Form Inputs

**Before:**
```tsx
<label className="text-xs font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
  Email Address
</label>
<input
  type="email"
  placeholder="user@example.com"
  className="mt-2 h-11 w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 text-sm text-on-surface outline-none focus:border-primary"
/>
<p className="text-xs text-on-surface-variant mt-1">We'll never share your email.</p>
```

**After:**
```tsx
import Input from "@/components/edplus/Input";
import { Mail } from "lucide-react";

<Input
  label="Email Address"
  type="email"
  placeholder="user@example.com"
  icon={<Mail size={16} />}
  hint="We'll never share your email."
  fullWidth
/>
```

**Props:**
- `label` — Optional label text
- `error` — Shows error message (overrides hint)
- `hint` — Optional help text
- `icon` — Optional leading icon
- `fullWidth` — Expands to full width

---

### Cards

**Before:**
```tsx
<div className="border-1 border-outline-variant rounded-xl bg-surface-container-lowest shadow-card p-6">
  <div className="border-b border-outline-variant pb-4 mb-4">
    <h2 className="text-xl font-bold">Card Title</h2>
  </div>
  <p>Card content goes here.</p>
  <div className="border-t border-outline-variant pt-4 mt-4 flex justify-end gap-2">
    <button>Cancel</button>
    <button>Save</button>
  </div>
</div>
```

**After:**
```tsx
import Card, { CardHeader, CardBody, CardFooter } from "@/components/edplus/Card";
import Button from "@/components/edplus/Button";

<Card elevated>
  <CardHeader>
    <h2>Card Title</h2>
  </CardHeader>
  <CardBody>
    <p>Card content goes here.</p>
  </CardBody>
  <CardFooter>
    <Button variant="ghost" size="md">Cancel</Button>
    <Button variant="primary" size="md">Save</Button>
  </CardFooter>
</Card>
```

**Props:**
- `elevated` — Adds shadow (default: false)
- `interactive` — Hover effect for clickable cards

---

### Modals

**Before:**
```tsx
{open && (
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-on-surface/40 backdrop-blur-sm px-4">
    <div role="dialog" className="relative w-full max-w-lg rounded-xl bg-surface-container-lowest shadow-2xl ghost-border">
      <div className="flex items-start justify-between gap-4 border-b border-outline-variant/20 px-6 py-5">
        <h2>Dialog Title</h2>
        <button onClick={() => setOpen(false)}><X size={16} /></button>
      </div>
      <div className="px-6 py-5">Content</div>
      <div className="flex justify-end gap-2 border-t border-outline-variant/20 px-6 py-4">
        <button>Cancel</button>
        <button>Confirm</button>
      </div>
    </div>
  </div>
)}
```

**After:**
```tsx
import Modal, { ModalBody, ModalFooter } from "@/components/edplus/Modal";
import Button from "@/components/edplus/Button";

<Modal
  open={open}
  onOpenChange={setOpen}
  title="Dialog Title"
  subtitle="Context label"
  size="md"
>
  <ModalBody>
    Your content here
  </ModalBody>
  <ModalFooter>
    <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    <Button variant="primary">Confirm</Button>
  </ModalFooter>
</Modal>
```

**Size options:**
- `size="sm"` — max-w-md (narrow)
- `size="md"` — max-w-lg (standard)
- `size="lg"` — max-w-2xl (wide)

---

### Badges

**Before:**
```tsx
<span className="inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
  Active
</span>
```

**After:**
```tsx
import Badge from "@/components/edplus/Badge";

<Badge variant="primary">Active</Badge>
```

**Variant options:**
- `"default"` — Neutral gray
- `"primary"` — Maroon tint
- `"success"` — Green tint
- `"warning"` — Yellow tint
- `"error"` — Red tint

---

### Alerts

**Before:**
```tsx
<div className="rounded-lg bg-blue-50 border border-blue-200 text-blue-900 p-4">
  <p className="font-semibold mb-1">Info Alert</p>
  <p>This is an informational message.</p>
</div>
```

**After:**
```tsx
import Alert from "@/components/edplus/Alert";

<Alert variant="info" title="Info Alert" onClose={handleClose}>
  This is an informational message.
</Alert>
```

**Variant options:**
- `"info"` — Blue
- `"success"` — Green
- `"warning"` — Yellow
- `"error"` — Red

**Props:**
- `title` — Optional heading
- `onClose` — Optional close callback (shows X button)

---

## Files to Update (Priority Order)

### High Priority (Frequently used)
1. `CreateModuleButton.tsx` — Use Modal + Button + Input components
2. `CreateContentItemButton.tsx` — Same pattern as CreateModuleButton
3. `HealthRunButton.tsx` — Use Button component
4. `SyncCourseButton.tsx` — Use Button component
5. `InventoryTable.tsx` — Use Alert for messages, Button for actions

### Medium Priority
6. `DocumentDetailManager.tsx` — Use Card for layouts, Modal for dialogs
7. `LinksManager.tsx` — Use Card + Modal pattern
8. `ImagesManager.tsx` — Use Card + Modal pattern
9. `QuizQuestionsPanel.tsx` — Use Card + Alert pattern
10. `FindReplaceManager.tsx` — Use Modal + Input pattern

### Lower Priority (One-off components)
11. `Tooltip.tsx` — Keep as-is (specialized behavior)
12. `ModuleItemReorderRow.tsx` — Update hover/active states
13. `ModuleItemStageActions.tsx` — Use Button variants
14. `TagFlowStructurePreview.tsx` — Use Alert for messages

---

## Styling Reference

### Color Variables (Use in custom CSS)
```css
--color-primary: #8c1d40;        /* ASU Maroon */
--color-secondary: #ffc627;      /* ASU Gold */
--color-on-surface: #191919;     /* Primary text */
--color-on-surface-variant: #6f6f6f; /* Secondary text */
--color-outline: #d0d0d0;        /* Strong rule */
--color-outline-variant: #efefef; /* Light hairline */
--color-error: #ba1a1a;
--color-surface: #ffffff;
--color-surface-container-low: #fafafa;
--color-surface-container-lowest: #ffffff;
```

### Spacing Scale (8px grid)
```
space-1:  4px    space-2:  8px    space-3: 12px
space-4: 16px    space-5: 24px    space-6: 32px
space-7: 48px    space-8: 64px    space-9: 96px
```

### Border Radius
```
radius-xs:  4px    radius-sm:  8px   radius-md:  12px
radius-lg: 16px    radius-xl: 24px   radius-pill: 999px
```

---

## Testing Your Migration

After updating a component:

1. **Visual check** — Ensure colors, spacing, and layout match EdPlus standards
2. **Interaction check** — Test hover, focus, active, and disabled states
3. **Accessibility check** — Verify focus rings, ARIA labels, and contrast ratios
4. **Responsive check** — Test on mobile and tablet sizes

---

## Questions & Support

Refer to:
- Component showcase: `/edplus-components` page
- Design system docs: `DESIGN_SYSTEM_UPDATES.md`
- EdPlus reference: `/projects/019ddac9-d351-7672-875b-b7b2eedd58cd/`

