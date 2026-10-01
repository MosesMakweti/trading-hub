# Traditorium Design System

**The single source of truth for all Traditorium UI.** Every page and component inherits
from this system — no one-off UI. Read this before designing or changing any screen, and
run the [Per-page checklist](#per-page-checklist) before you implement.

> This document **codifies and refines the system already in the codebase** (OKLCH tokens
> in `src/app/globals.css`, Geist type, `.glass`/brand-gradient/elevation utilities). It is
> not a proposal to rebuild — it formalizes what exists, fills the gaps (type scale, motion
> tokens, glass depth hierarchy, chart language), and sets the rules future work must follow.

Grounded in research of premium information-dense software (Linear, Stripe/Vercel dashboards,
TradingView, Raycast, Superhuman) and the `ui-ux-pro-max` design-intelligence base. Traditorium
has its **own** identity — these are references, not templates.

---

## 1. Philosophy & experience principles

Traditorium is software a professional trader lives in **8–12 hours a day**. Every decision
serves that: reduce stress, sharpen focus, encourage discipline.

It should feel: **professional · premium · institutional · focused · fast · elegant ·
disciplined · calm.**

Five operating principles:

1. **Data outranks chrome.** Trading metrics (PnL, R, win rate, grade) get the highest
   visual weight; labels and descriptions recede. Never let decoration compete with a number.
2. **Calm by default, signal on change.** A resting screen is quiet — neutral ink, generous
   whitespace, one accent. Color and motion are spent only where they mean something
   (positive/negative, current step, saved).
3. **Depth through shadow, sparingly.** Opaque surfaces + resting shadows establish hierarchy
   (what floats above what), not novelty. Glassmorphism (frosted/translucent panels) was
   removed app-wide — see §7.
4. **One system, everywhere.** Same tokens, same components, same spacing rhythm on every
   page. Consistency is the premium signal.
5. **Accessible is non-negotiable.** 4.5:1 text contrast, visible focus, keyboard paths,
   reduced-motion, never color-alone — a trading tool must be legible when tired and fast.

**Avoid:** visual clutter · crypto neon · gaming aesthetics · overloaded dashboards · heavy
gradients on content · large distracting animation · emoji as icons · raw hex in components.

### Brand: Traditorium

**Traditorium — the operating environment for traders.** The name (`Tradit·orium`,
"the place where the parts of a trader's operation come together") is set as a wordmark:
`Tradit` in Geist Sans semibold + `orium` in Geist Mono, `text-primary` — the mono suffix
is the "environment" half, echoing the `-OS` treatment it replaces.

The **mark** (`components/brand/TraditoriumMark`) is a "T" beam spanning a single
candlestick — one roof over the whole of a trader's operation, with the trade standing
under it. Monochrome, drawn on lucide's 24×24 grid at matching stroke weight,
`currentColor`, and legible down to favicon size. It rides the same `bg-brand-gradient`
+ `shadow-glow` chip as before — no new color is introduced; the interface stays
graphite/white/gray. Browser-tab icon: `src/app/icon.svg` (white mark on a `#1C1E24`
rounded square).

---

## 2. How tokens work

- **Tailwind v4, CSS-first.** Tokens are CSS variables mapped into Tailwind's theme via
  `@theme inline` in `src/app/globals.css`. Use the **utility** (`bg-card`, `text-success`,
  `rounded-2xl`) — never a raw hex/oklch in a component.
- **OKLCH color.** All colors are `oklch(L C H)` for perceptually even lightness and clean
  dark-mode derivation. You rarely touch raw values — you use the semantic token.
- **Dual theme.** Light and dark are both first-class (`prefers-color-scheme` + a
  `data-theme` override from `next-themes`). **Dark is the primary/default experience.**
  When you add a token, define it for **both** themes.
- **Theme swaps cross-fade** (`background-color`/`border-color` 0.3s) — don't add your own
  color transitions that fight it.

> **Rule:** components consume semantic tokens only. If you need a value that has no token,
> add a token (both themes) — don't hardcode.

---

## 3. Color system

### 3.1 Semantic tokens (each has a `-foreground` pair where text sits on it)

**Identity: monochromatic graphite, opaque surfaces.** The interface is **black / white / gray** —
a layered *neutral* graphite ground (chroma ≈ 0, not blue-black) with solid, opaque raised
surfaces (glassmorphism was removed app-wide — see §7). There is **no color accent**: the primary CTA/active state is an **inverting ink↔white pair**
(`primary` = near-black in light → near-white in dark; `primary-foreground` inverts with it), giving
a premium near-black button in light mode and a near-white button in dark. Color appears **only**
where it is semantic: `success`/`danger`/`warning` for P&L & state, and the muted confluence tag
hues. `chart-1`, links, and `brand` are all neutral graphite — never blue.

| Token | Role | Dark value (primary) |
|---|---|---|
| `background` | app canvas (matte) | `oklch(0.15 0.003 265)` ≈ `#111114` |
| `foreground` | primary ink | `oklch(0.965 0.003 265)` |
| `card` / `card-foreground` | opaque raised surface | `oklch(0.196 0.004 265)` ≈ `#16181D` |
| `muted` / `muted-foreground` | secondary surface / secondary ink | `oklch(0.225 …)` / `oklch(0.705 …)` |
| `accent` / `accent-foreground` | hover/active tint | `oklch(0.265 0.006 265)` |
| `primary` / `primary-foreground` | **monochrome action** (inverting ink↔white) | `oklch(0.93 0.003 265)` / `oklch(0.2 0.004 265)` |
| `sidebar` | deepest surface | `oklch(0.125 0.003 265)` ≈ `#0B0B0D` |
| `border` | hairlines | `oklch(1 0 0 / 8%)` |
| `ring` | focus ring (neutral) | `oklch(0.8 0.004 265 / 40%)` |
| `success` | **profit / good** | `oklch(0.72 0.13 158)` (green) |
| `danger` | **loss / destructive** | `oklch(0.66 0.19 25)` (red) |
| `warning` | caution | `oklch(0.78 0.13 80)` (amber) |
| `glass` / `glass-border` | opaque `.glass`/`.glass-strong` surface + its edge (mirrors `card`/`border`) | see §7 |
| `brand` / `brand-from` / `brand-to` | **neutral graphite** (decorative chips/nodes only) | `~0.34 0.006 265` |
| `sidebar*` | nav surface family | deepest surface |
| `chart-1…5` | legacy neutral series (being replaced by `viz-*`) | see §10 |
| `viz-1…6`, `viz-profit/loss/neutral/warning/reference/grid/axis` | data-visualization roles (marks only) | see §10 |

> **Monochrome rule:** the UI is graphite/white/gray. Never introduce blue/purple/pink/neon as an
> accent. The only colors are the reserved semantic set (§3.2), the muted tag hues (§4), and the
> validated **data-visualization hues** (`--viz-1…6`, §10) — which colour chart marks only, never text,
> buttons or chrome. `primary` and `brand` are neutral — a colored primary is a regression.

### 3.2 PnL & status color — the most important rule

Positive/negative money must be **instantly recognizable yet elegant** — our green/red are
**desaturated OKLCH**, never the neon `#00FF00`/`#FF0000` of crypto UIs.

- **Profit / up / win** → `text-success`. **Loss / down** → `text-danger`. Flat/open →
  `text-muted-foreground`.
- **Always pair color with a second cue** — a leading `+`/`−` sign, an arrow, or a label.
  Color is never the *only* carrier (colorblind + glance-reading). Example: `+US$900.00`,
  `−1.20R`, not just a green number.
- **Reserve status colors.** `success`/`danger`/`warning` mean profit/loss/caution — never
  reuse them as a decorative accent or a chart series #4.
- Numbers are `tabular-nums` (see §4) so signs and decimals align in columns.

### 3.3 Accessibility

- Body/label text ≥ **4.5:1** against its surface; large/bold ≥ 3:1. `foreground` on
  `background`/`card` and `muted-foreground` on those surfaces all pass — verify any new
  pairing. Never gray-on-gray below 4.5:1.
- On a `.glass` surface, contrast is measured against the *effective* (blended) background —
  keep glass fills light-touch and text in `foreground`, not `muted`, when small.
- Status/PnL colors ship with sign/label (§3.2), so meaning survives grayscale/CVD.

---

## 4. Typography

**Fonts:** `Geist` (sans, `--font-geist-sans`) for all UI; `Geist Mono` (`--font-geist-mono`)
for code, IDs, keyboard hints, and raw timestamps. Geist is a clean, modern, neutral grotesque
— premium without personality noise, with excellent figures. (Research alternatives for this
role: IBM Plex Sans / Inter — Geist fills the same "trustworthy data sans" slot with a more
modern feel; keep Geist.)

**Numerals — the trading-data rule:** every metric, price, R, %, count, and table figure uses
**`tabular-nums`** (lining tabular figures) so digits, signs, and decimals align vertically and
don't jitter as they update. Apply `tabular-nums` on the element; do **not** switch fonts for
numbers — Geist Sans + `tabular-nums` is the house numeric style. Reserve Geist **Mono** for
non-metric monospace needs (keys, IDs).

**Type scale** (modular, aligns to Tailwind text sizes; line-height in parens):

| Role | Size | Weight | Notes |
|---|---|---|---|
| Display | `text-3xl` 30px (→ `sm:text-4xl`) | 600 | page hero (Dashboard/Today/Edge titles) |
| Page title | `text-2xl` 24px | 600 | section pages |
| Section heading | `text-lg` 18px | 600 | workspace sections |
| Card heading | `text-sm` 14px | 500–600 | card titles |
| Body | `text-sm` 14px (1.5) | 400 | default UI copy |
| Body large | `text-base` 16px (1.5) | 400 | long-form (rich-text editors) |
| Caption / label | `text-xs` 12px | 500 | field labels, meta; often `text-muted-foreground` + `uppercase tracking-wide` for KPI labels |
| Metric (KPI) | `text-2xl` 24px | 600, `tabular-nums` | the number is the hero of a stat tile |
| Metric (inline) | inherits, 500–600, `tabular-nums` | R/PnL inside cards/tables |

Rules: base body **never < 12px**; sequential heading levels (`h1→h2→h3`, no skips — SRs
navigate by them); one modular scale, no arbitrary sizes; a metric always outweighs its label.

---

## 5. Spacing

An 8px-based scale (Tailwind step = 4px). Use it for **all** padding, gaps, and margins.

| Token | px | Typical use |
|---|---|---|
| `1` | 4 | icon↔text, tight chips |
| `2` | 8 | inside compact controls, badge gaps |
| `3` | 12 | control padding, small gaps |
| `4` | 16 | **card padding**, form field gaps |
| `6` | 24 | gaps between cards, section inner spacing |
| `8` | 32 | between major sections |
| `10`–`12` | 40–48 | page-level rhythm, hero spacing |

**Generous whitespace is the calm.** Card interiors use `p-4`; stacked sections use
`space-y-6`; page shells use `space-y-6`/`space-y-10`. Don't crowd — density comes from
*organization*, not from removing air.

---

## 6. Border radius

Sharp, institutional scale from `--radius: 0.5rem` (8px). Reduced roundness is a core part of
the trading-desk read — surfaces feel precise, not soft. Consistency here is a big premium signal.

| Utility | ~value | Use |
|---|---|---|
| `rounded-md` | ~6px | **inputs**, select triggers |
| `rounded-lg` | 8px | **buttons**, menu items, small tiles |
| `rounded-xl` | ~9px | inner tiles inside a card |
| `rounded-2xl` | ~10px | **cards, panels, sections** (the default surface radius) |
| `rounded-full` | — | badges, pills, avatars, icon dots, toggles |

Cards/panels = `rounded-2xl` (~10px). Badges/status pills = `rounded-full`. Avoid pill shapes on
non-status surfaces. Never mix radii within one component family.

---

## 7. Elevation (glassmorphism removed)

The app was originally glassmorphic (frosted, translucent panels). That's been **removed
app-wide**: `.glass` and `.glass-strong` are now plain **opaque** surfaces — no backdrop blur, no
tint, no reflection sheen. Elevation is carried entirely by a solid `var(--card)`-matching
background, a crisp `1px solid var(--glass-border)` border (mirrors `var(--border)`), and a resting
shadow. The two classes exist only so the ~60 components that already reference them keep working;
they're visually equivalent to an opaque `card` now.

**`.glass`** — solid background + border + a **gentle resting shadow** (`0 8px 20px -12px` /
`0 24px 50px -24px`) so the card still reads as slightly raised off the canvas.

**`.glass-strong`** — same opaque background, a **deeper resting shadow** (`0 24px 56px -22px`)
only — for hero / overlay surfaces that should sit **above** cards: the dashboard vitals strip,
dialogs, popovers. One `.glass-strong` layer above a field of `.glass` cards — never stacked.

New code should reach for the standard opaque `Card` component (`bg-card` + `ring-foreground/10` +
`shadow-elevated`) rather than `.glass`/`.glass-strong` — they're kept for backward compatibility,
not as the preferred surface primitive going forward.

### Depth hierarchy (bottom → top)

| Layer | Treatment | Examples |
|---|---|---|
| 0 · Canvas | `background` + fixed radial brand wash (soft-light) | the page body |
| 1 · Sidebar/nav | deepest solid surface (`sidebar`) | app sidebar, topbar |
| 2 · Surface card | `.glass` (or opaque `card`) `rounded-2xl` | KPI tiles, workspace sections, list cards |
| 3 · Elevated | `.glass` + `shadow-elevated`, subtle `-translate-y-0.5` on hover | interactive cards, gallery cards |
| 4 · Overlay | `.glass-strong` (heavier blur + deeper shadow) | dialogs, popovers, dropdowns, command palette, dashboard vitals strip |
| Accent · Glow | `.shadow-glow` + `bg-brand-gradient` | primary CTAs, active workflow node, brand chips |

**Do:** use glass for cards, nav, overlays, and floating panels; keep exactly one glow accent
in view (the CTA or the current step). **Don't:** stack glass on glass on glass; put glass on
tiny elements (badges, inputs); rely on blur where text would drop below 4.5:1.

### Shadows

- `shadow-elevated` — layered soft shadow (theme-aware via `--shadow-color`); default lift for
  cards/menus/dialogs.
- `shadow-glow` — a restrained **neutral** ring+depth for the primary CTA / active node (the colored
  glow is retired; monochrome interface).
- Hover lift: `hover:-translate-y-0.5 hover:shadow-elevated` (transform+shadow only — see §8).
- `gradient-ring` — a subtle 1px gradient border for a premium framed element (use rarely).

---

## 8. Motion

Motion **communicates state change**, never decorates. Subtle, fast, purposeful.

**Tokens / rules:**
- **Duration:** 150–250ms for micro-interactions and entrances; ≤ 300ms for anything UI.
  Never > 400ms. (Exception: **entry surfaces**, below, may run longer, decorative motion.)
- **Easing:** `ease-out` for entrances/hover (fast-in, settle); avoid linear for UI. The
  premium settle easing is **`--ease-out-expo`** = `cubic-bezier(0.16, 1, 0.3, 1)` (Expo.out) —
  use it for staged entrances and the entry-surface choreography.
- **Animate only `transform` + `opacity`** (GPU-cheap, no layout thrash). Never animate
  `width`/`height`/`top`/`left`.
- **`prefers-reduced-motion`:** always respected. The shared `FadeIn` / `StaggerList` /
  `StaggerItem` (`components/shared/motion.tsx`) use `useReducedMotion()` and render at final
  state with no transform/stagger when the user opts out. Any new animation must do the same.

**House interactions:**
- **Page/section entrance:** `FadeIn` (opacity+8px rise, 250ms). Lists use `StaggerList` +
  `StaggerItem` (~50ms stagger).
- **Hover on interactive cards:** `-translate-y-0.5` + `shadow-elevated`, ~200ms.
- **Saved/loading:** inline `SaveDot` (spinner → check), `animate-spin` on `Loader2`,
  `Skeleton` (`animate-pulse`) for route loads.
- **Workflow stepper:** state is expressed by node style (gradient=done, ring=current, dashed=
  upcoming), not by an animation — motion is reserved for the transition, not the resting state.

**Entry surfaces vs work surfaces (the cinematic rule).** *Work surfaces* (dashboard, Today,
journal, workspaces — anything a trader stares at all day) stay calm: micro-motion only, per the
tokens above. *Entry surfaces* (login, register, and any future landing/marketing page) are the
first impression and may be genuinely **cinematic** — drifting aurora, an animated equity-curve
motif, longer staged reveals on `--ease-out-expo`. Reusable primitives (in `globals.css`,
all `prefers-reduced-motion`-gated): `.aurora-orb` (drifting blurred glow), `.grid-fade` (masked
blueprint grid), `.animate-gradient-pan` (hero gradient sweep), `.animate-pulse-glow` (breathing
node). The flagship implementation is `components/auth/auth-brand-panel.tsx`. Never bring this
level of motion onto a work surface.

---

## 9. Iconography

- **One library: `lucide-react`.** Outline, consistent stroke. No emoji as UI icons, no mixing
  icon sets.
- Icons **aid usability**, not decorate: pair with a text label; size `size-3.5`/`size-4`
  (inline) or `size-4.5`/`size-5` (nav/headers).
- **Icon-only controls must have `aria-label`.** Decorative icons get `aria-hidden`.
- Semantic icon vocabulary (keep stable): Dashboard `LayoutDashboard` · Today `Sun` · Journal
  `BookOpenText` · Edge `TrendingUp` · Accounts `Wallet` · Strategy Lab `FlaskConical` ·
  Prep `Sunrise` · Plan `ClipboardList` · Trade `CandlestickChart` · Review `BookOpenCheck` ·
  Analyze `BarChart3` · Gallery `Images`.

---

## 10. Chart styling

All charts must look like one application. The full spec — audit, validated
palette, primitives and phase status — lives in
[`ANALYTICS_VISUALIZATION.md`](./ANALYTICS_VISUALIZATION.md); this is the
summary every page must follow.

- **One kit.** Build charts from `src/components/viz/` (`ChartCard`,
  `ChartTooltip`/`TooltipCard`, `ChartLegend`, tokens, formatters, series
  helpers) on Recharts. Never hand-style a chart's tooltip, grid or axes.
- **Colour by job, data marks only.** Polarity (`--viz-profit`/`--viz-loss`/
  `--viz-neutral`) for money, R and returns; `--viz-warning` for status;
  `--viz-1…6` (blue, cyan, violet, teal, orange, magenta) for **identity** —
  strategies, sessions, datasets, comparison series; `--viz-reference`
  (dashed) for expected/targets/limits/averages. These hues are validated for
  CVD and contrast against the card surface in both themes — never edit them
  by eye. They colour **marks only** (lines, bars, fills, swatches): text,
  buttons and UI accents stay monochrome (§3).
- **Identity is stable.** Assign slots with `identityColorMap(allKeys)` over
  the full entity list, never by rank, so filtering never repaints survivors.
  Past six identities, fold into "Other" (neutral).
- **One axis** — never dual-y. Two measures of different scale → two charts
  (optionally `syncId`-linked), small multiples, or index to a common base.
- **Recessive frame:** solid 1px gridlines (`--viz-grid`, never dashed),
  muted axis labels, no chart border box. Dashes mean *reference*, nothing else.
- **Marks:** 2px lines; bars ≤ 24px with a 4px rounded data end; area washes
  ≈ 10–20%; end-dots ≥ 8px with a 2px surface ring.
- **Numbers:** ticks and tooltips `tabular-nums`; signed values carry `+`/`−`
  (true minus) as well as polarity colour.
- **Always** a tooltip (crosshair on line/area, per-mark on bars/cells) that
  says what changed and by how much; a legend for ≥ 2 series; empty and loading
  states that reserve the plot height (`ChartCard`). Refetch holds the previous
  frame at reduced opacity.

---

## 11. Component library

Build from these; don't invent one-offs. (Location → purpose.)

**Primitives — `components/ui/*`:** `Button` (variants: default/gradient-glow · outline ·
ghost · destructive; sizes incl. `icon-sm`), `Input`, `Textarea`, `Select` (Base UI:
`SelectTrigger`/`Content`/`Item`), `Checkbox`, `Tabs`, `Badge` (variants: default · success ·
danger · warning · outline · secondary), `Sidebar`, `Skeleton`, dialog/popover primitives.

**Shared — `components/shared/*`:** `FadeIn` / `StaggerList` / `StaggerItem` (motion),
`EmptyState` (icon + title + description), `ConfirmDialog`, `SectionPlaceholder` (documented
"coming in phase X" shell), `CommandCenter` (⌘K), `ThemeToggle`.

**Dataviz primitives — `components/analytics/*` (all pure inline SVG, server-safe, zero client JS):**
- `Sparkline` — tiny dependency-free trend line for KPI cards and table rows; `tone` auto-colors
  green/red by the series' end-vs-start, or force brand/success/danger/muted. Use it to give a
  headline number visual context, never as a standalone chart.
- `DeltaChip` (+ `directionOf` helper) — the "vs previous" pill: arrow + value, tinted
  green (up) / red (down) / muted (flat). The canonical change-indicator.
- `ProgressRing` — radial gauge for one 0–100% metric; center holds the value (or `children`),
  data-hued (brand) by default because a ring shows magnitude, not status.
- `Donut` — categorical distribution as a segmented ring (2px surface gaps per the dataviz mark
  specs); optional legend carries identity, never color alone. Center holds a headline via `children`.

**Composites (reuse across modules):**
- `KpiCard` (`components/analytics`) — the **metric-with-context** tile: uppercase label + optional
  `icon`, hero `tabular-nums` value, optional `sublabel`, `tone` (neutral/success/danger), and
  optional context — a `delta` (→ `DeltaChip`) and/or a `spark` series (→ `Sparkline`, `sparkTone`).
  The canonical way to show a metric; prefer wiring real context over a bare number.
- `EquityCurveChart` — the house equity/return chart.
- `WorkflowProgress` (`components/dashboard`) — the Prep→Plan→Trade→Review→Analyze stepper
  (gradient/ring/dashed nodes; `aria-current="step"`). Driven by the pure `deriveWorkflowSteps`.
- `TradeStatusBadge`, `GRADE_VARIANT` badges — status/psychology grade pills.
- `SaveDot` + `SectionCard` (`components/today/today-ui`) — the autosave indicator + titled
  glass card used by every workflow section.
- `RichTextEditor` (Tiptap) + `useDebouncedAutosave` — the standard editable-text + autosave
  pattern; `tiptapToPlainText` for read-only previews.
- `WorkspaceField` / `NoteBlock` (`journal/workspace/workspace-ui`) — labelled read-only
  value / multiline note, with "—" and italic placeholders.

Formatters (one source): `formatRR`, `formatCurrency`, `formatSignedCurrency`
(`workspace-ui`); `formatDateKeyLong` / `formatDateKeyShort` (`lib/date`).

---

## 12. Layout & responsive

- **Mobile-first**, Tailwind breakpoints: `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`.
  Never a fixed-px container width; never disable zoom; **no horizontal page scroll** — wide
  content (tables, charts, tab bars) scrolls inside its own `overflow-x-auto` box.
- **Page shells** are centered with a max width matched to density: `max-w-4xl` (focused: a day,
  a trade), `max-w-5xl` (workspaces: Today/Edge), `max-w-6xl` (dashboards/galleries), inside the
  sidebar layout. Vertical rhythm `space-y-6`.
- **Grids:** KPI rows `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`; card galleries
  `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`. Collapse to 1 column on mobile.
- Tab bars and stepper rows wrap/scroll on small screens (`overflow-x-auto`), never overflow.

---

## 13. Accessibility standards (must-pass)

1. **Contrast** ≥ 4.5:1 body/label, ≥ 3:1 large — including on glass.
2. **Focus** always visible — `ring` token via `focus-visible:ring-2`; never `outline-none`
   without a replacement.
3. **Keyboard**: every action reachable and operable; logical order; no hover-only affordances.
4. **Names**: icon-only buttons get `aria-label`; decorative icons `aria-hidden`; inputs have
   visible labels (placeholder is not a label).
5. **Semantics**: sequential headings; lists as `<ul>/<ol>`; `<time datetime>`; `aria-current`
   for the active step/nav; `role="alert"`/`aria-live` for errors.
6. **Motion**: honor `prefers-reduced-motion` (§8).
7. **Targets**: interactive hit area ≥ 44×44px (pad small icon buttons); ≥ 8px between targets.
8. **Never color-alone** (§3.2, §10).

---

## 14. Signature UI patterns

- **Metric / KPI tile** → `KpiCard`. Uppercase muted label on top, big `tabular-nums` value,
  optional signed sublabel with `tone`. Metric outweighs label. Use for every headline number.
- **Workflow stepper** → `WorkflowProgress`. Gradient node = done, ringed = current, dashed =
  upcoming; icon + text label per step; `aria-current` on current. The spine of Today &
  Dashboard.
- **Section card** → `SectionCard`/`.glass rounded-2xl p-4`: title (+ optional `SaveDot`), body.
  Every workflow section and recap block uses it.
- **Status pill** → `Badge` with the reserved success/danger/warning/neutral variants +
  `TradeStatusBadge` (Open/Closed/Reviewed), grade badges. Round-full, small, text + color.
- **Empty state** → `EmptyState`: brand-gradient icon chip, title, one-line guidance, and a path
  forward. Never a blank region.
- **Loading** → route `loading.tsx` with `Skeleton` blocks mirroring the real layout (reserve
  space → no CLS). Inline saves → `SaveDot`.
- **Forms** → visible labels above fields; helper text below; errors inline next to the field
  (`role="alert"`), not only at the top; numeric inputs set `inputmode`.
- **Read vs edit** → archived/historical views are read-only (`WorkspaceField`/`NoteBlock`);
  live workflow uses inline autosave (`RichTextEditor` + `useDebouncedAutosave`, `SaveDot`).

---

## 15. Per-page checklist

Before implementing or redesigning any page, confirm:

- [ ] Uses **only** design-system tokens/components (no raw hex, no one-off UI).
- [ ] **Information hierarchy** is immediately clear; the most important number is the most
      prominent thing.
- [ ] Metrics use `tabular-nums`; PnL/status carry a **sign or label**, not color alone.
- [ ] Glass is used **selectively** for real depth; contrast stays ≥ 4.5:1 on every surface.
- [ ] Spacing follows the scale; the page feels **calm** (generous whitespace), not crowded.
- [ ] Cards `rounded-2xl`, one consistent radius family; one visible glow accent max.
- [ ] Every animation is **purposeful**, ≤ 300ms, transform/opacity, reduced-motion-safe.
- [ ] Keyboard-operable; visible focus; icon-only buttons labelled; headings sequential.
- [ ] Responsive to mobile with no horizontal scroll; wide content scrolls in its own box.
- [ ] Has real **empty** and **loading** states.
- [ ] It looks like premium commercial software a professional trader would **pay for and use
      all day**. If not — refine before shipping.

---

## 16. Anti-patterns (do not)

Raw hex/oklch in components · neon or oversaturated green/red · color as the only signal ·
glass on everything (or on tiny elements) · heavy gradients behind content · emoji or mixed
icon sets · decorative-only animation / motion > 400ms / animating layout properties ·
dual-axis charts · cycling/recoloring chart series per filter · gray-on-gray text · fixed-px
widths / horizontal page scroll · placeholder-as-label · dead-end blank/empty screens ·
one-off components that duplicate an existing one.
