# UI conventions

Short rules for building screens that look and behave like the rest of the app. The code behind them is `src/components/ui/` (primitives, `styles.ts`, `color.ts`) and `src/index.css` (tokens and the two looks).

## Build from the primitives

`src/components/ui/primitives.tsx` has the building blocks: `Button`, `Input`, `TextArea`, `Select`, `Field`, `Label`, `Panel`, `Disclosure`, `Tabs`, `Chip`, `EmptyState`, `LoadingState`, `Notice`, `Help`/`HelpToggle`, `TypeBadge`, `MonAvatar`; `Modal` is the dialog (a bottom sheet on phones), `Menu` the dropdown, `Combobox` the picker, `Toaster` the toasts.

- Something that has to look like a button or a field but cannot be one (a Radix trigger, a label around a file input) uses `buttonClass()` / `controlClass()` from `styles.ts`.
- One empty state (`EmptyState`), one loading state (`LoadingState`, which is announced politely), one inline alert (`Notice`: `role="alert"` for errors). Don't hand-roll a "Loading…" paragraph or a `Suspense fallback={null}` for something the person is waiting for.
- Radius: `rounded-md` chips and badges, `rounded-lg` controls, `rounded-xl` panels and cards. Smallest reading size is `text-xs`; 10–11 px only for badges and labels.

## Colour comes from tokens

Use the Tailwind theme utilities (`bg-surface`, `text-muted`, `border-border-strong`, `text-bad`…), never a hex value or a Tailwind palette colour (`text-white`, `bg-red-500`). The tokens live in `@theme` and `.dark` in `index.css`, and Settings → Appearance can replace the neutrals and the accent (`src/domain/palette.ts`), so a hard-coded colour breaks for some palettes.

- A custom palette also darkens or lightens the status colours (`good`, `warn`, `bad`, the stat colours) until they read on its surfaces (`src/domain/palette.ts`); the values in `STATUS_BASE` mirror `index.css`, and a test keeps them in step.
- Text on a filled colour uses the matching foreground: `text-accent-fg` on `bg-accent`, `text-bg` on `bg-bad`.
- `src/components/ui/__tests__/contrast.test.ts` checks every token pair for WCAG AA in both themes; add a pair there when a new one is used.
- Meaning is never colour alone: pair it with an icon, a symbol (▲ ▼ ✓ ✗) or words.
- Map and type colours (`TYPE_COLORS`, `TYPE_BADGE`) are the only fixed colours; the SVG maps (`SchematicMap`, `AtlasMap`, `RegionMap`) draw with their own.

## Touch targets and phones

Anything tappable is at least 44 × 44 pt on a touch screen. The primitives do this with `pointer-coarse:` classes (`h-9` → `pointer-coarse:h-11`); a small visual control that must stay small (an icon button inside a row) uses the `hit` class, which enlarges the touch area without changing the look. Inputs are 16 px on phones so iOS doesn't zoom.

Nothing may scroll the page sideways: a wide table sits in its own `overflow-x-auto` region with a label and `tabIndex={0}`. `e2e/views.spec.ts` fails if any main screen does.

## The two looks

Sticker (default) and Classic are switched by `data-look` on `<html>`. Sticker is applied by CSS only (`index.css`: thick outlines, hard shadows that press flat); components don't branch on it. A new surface gets the Sticker look by using `Panel`, `Button`, `Chip`, `Tabs`, `Modal` or `Menu`, or by carrying `ui-panel` / `ui-sheet` / `ui-cell`. The press animation is switched off under `prefers-reduced-motion`, as is every other CSS animation (global rule at the top of `index.css`).

## Destructive actions

- Small local data (a logged match, a benchmark, a goal, Pokénav progress, a cleared team): do it, then show a toast with **Undo** (`toast(message, { label: 'Undo', run })`). No `window.confirm`.
- Bigger or shared data (a saved team, a run, linked devices, stopping a share): ask first, inline, with the destructive button first (`Delete`) and the safe one second (`Keep`).

## Accessibility checklist

- Every control has an accessible name; icon-only buttons have an `aria-label`.
- Dialogs use `Modal` (focus is trapped; on close `returnFocus` gives it back to the last control you used, which also covers dialogs opened from a menu or a shortcut); a new popup that isn't Radix needs the same, with Escape to close.
- Keyboard shortcuts live in `src/domain/hotkeys.ts` (pure) and `ShortcutsDialog.tsx`; add new ones there so the list stays true.
- Tables have a `<caption className="sr-only">` and `scope` on headers; a grid cell that is interactive is a real button.
- Run `npm run e2e`: it runs axe (WCAG 2.0/2.1 A + AA) on every main view in both themes.

## Adding a view

A route (`src/domain/routes.ts`), a command-palette entry (`CommandPalette.tsx`), the nav label (`src/domain/navigation.ts`), and e2e (`e2e/navigation.spec.ts`, plus an axe test in `e2e/a11y.spec.ts`).
