# Theming & white-labeling

Everything user-facing can be rebranded at runtime from
**Admin → Branding & access** — no rebuild, no restart. Settings persist in
Postgres and apply to all users immediately.

## Branding

- **App name** — replaces "Parley" in the sidebar, page titles, and auth
  screens.
- **Tagline** — shown on the sign-in/sign-up pages.
- **Logo URL** — any image URL (SVG recommended); shown in the sidebar and
  auth pages. Leave empty for the default mark.
- **Chat disclaimer** — small print under the composer, e.g. "Agents can
  make mistakes."

## Custom CSS

The **Custom CSS** field is injected globally on every page. Parley's UI is
built on shadcn/ui, so the entire look is driven by CSS custom properties on
`:root` (light) and `.dark` (dark). Paste a theme from
[tweakcn](https://tweakcn.com) or any shadcn theme generator, or write your
own:

```css
:root {
  --primary: oklch(0.55 0.2 260);
  --primary-foreground: oklch(0.98 0 0);
  --radius: 0.5rem;
}

.dark {
  --primary: oklch(0.7 0.18 260);
  --background: oklch(0.16 0.01 260);
}
```

Commonly overridden tokens: `--background`, `--foreground`, `--card`,
`--popover`, `--primary`, `--secondary`, `--muted`, `--accent`,
`--destructive`, `--border`, `--input`, `--ring`, `--radius`, and the
`--sidebar-*` family. Values use `oklch()` by default but any CSS color
works.

You're not limited to tokens — it's plain CSS, so font imports, per-element
tweaks, and `@media` rules all work. Keep selectors on stable things (CSS
variables, semantic elements) rather than hashed class names.

## Dark mode

Users toggle light/dark from their user menu; the preference persists per
browser. Custom themes should style both `:root` and `.dark` so both modes
look intentional.

## Deeper changes

For structural changes beyond branding and CSS, fork and edit:

- `src/styles/app.css` — base token definitions and Tailwind layer
- `src/components/ui/` — shadcn component primitives
- The name "Parley" only appears as the *default* of the `appName` setting;
  the codebase reads the runtime setting everywhere else.
