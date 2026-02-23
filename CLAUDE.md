# CLAUDE.md — Brand Repository Guide

This file describes the structure, conventions, and workflows for this repository. Read it before making any changes.

---

## Repository Purpose

This is the central brand asset repository for two personal/professional websites:

- **acker.cloud** — Personal site & resume (Zac Acker)
- **thrivecmd.com** — Content, culture, and side projects (Thrive Culture Media)

Both sites are powered by **Notion + Super.so** (a Notion-to-website platform). This repo provides:

- Custom CSS injected into Super.so pages
- Custom HTML body/head snippets injected per page
- Static image/media assets served via jsDelivr CDN

There is no build system, bundler, package manager, or JavaScript framework. Everything is plain HTML and CSS.

---

## Directory Structure

```
brand/
├── README.md
├── CLAUDE.md                          ← this file
│
├── acker_cloud/                       ← acker.cloud site assets
│   ├── README.md
│   ├── img/
│   │   ├── acker.jpeg                 ← profile photo
│   │   ├── alogo.avif                 ← brand logo
│   │   └── atech.avif                 ← tech/secondary logo
│   ├── home/
│   │   ├── home_head.html             ← font imports + hero CSS (injected into <head>)
│   │   ├── home_css.html              ← Notion header suppression CSS
│   │   └── home_body.html             ← hero section HTML + scroll progress bar JS
│   ├── contact/
│   │   ├── contact_css.html           ← contact page styles
│   │   └── contact_body.html          ← contact section HTML
│   ├── portfolio/
│   │   └── portfolio_css.html         ← Notion header suppression CSS
│   └── wiki/
│       └── wiki_css.html              ← Notion header suppression CSS
│
└── thrivecmd/                         ← thrivecmd.com site assets
    ├── site_css.html                  ← global CSS (Pillars of Creation fixed background)
    ├── home/
    │   ├── home_head.html             ← Google Font import (Orbitron)
    │   ├── home_css.html              ← hero section CSS (scanlines + floating blips)
    │   └── home_body.html             ← hero section HTML
    ├── numinous/
    │   ├── numinous_css.html          ← Pillars of Creation background (div-based)
    │   └── numinous_body.html         ← #pillars-bg div element
    └── ignition_protocol/
        └── ignition_protocol_css.html ← starfield/space CSS with animations
```

---

## File Naming Conventions

Files follow a strict `{page}_{type}.html` pattern:

| Suffix | Purpose | Injected into |
|---|---|---|
| `_head.html` | Font/resource imports, root-level styles | Super.so "Head" injection |
| `_css.html` | Page-scoped CSS wrapped in `<style>` tags | Super.so "CSS" injection |
| `_body.html` | HTML markup wrapped in `<body>` tags | Super.so "Body" injection |

Each file must be self-contained and injectable as a raw snippet — do not assume any shared context between files.

---

## How Files Are Deployed

Files in this repo are **served live via jsDelivr CDN** from GitHub:

```
https://cdn.jsdelivr.net/gh/zacker3310/brand@main/{path/to/file}
```

Example (profile photo used in contact_body.html):
```
https://cdn.jsdelivr.net/gh/zacker3310/brand@main/acker_cloud/img/acker.jpeg
```

**Important:** jsDelivr caches aggressively. After pushing updates to `main`, CDN-cached files may take time to update. For immediate cache purging, use:
```
https://purge.jsdelivr.net/gh/zacker3310/brand@main/{path/to/file}
```

---

## Design Systems

### acker.cloud

| Property | Value |
|---|---|
| Font | Inter (Google Fonts) |
| Background | `#0a0a0a` / `#0d0d0d` (near-black) |
| Primary accent | `#EB5757` (Notion Red) |
| Dark accent | `#C63D3D` |
| Theme | Dark, minimal, professional |

**CSS variables (defined in `acker_cloud/home/home_head.html`):**
```css
--notion-red: #EB5757;
--notion-red-dark: #C63D3D;
--notion-red-shadow: rgba(235, 87, 87, 0.4);
--white-soft: rgba(255, 255, 255, 0.04);
```

### thrivecmd.com

| Property | Value |
|---|---|
| Font | Orbitron (Google Fonts) — futuristic/sci-fi |
| Background | Cosmic/space (Pillars of Creation: `heic2226a.jpg` via ESA CDN) |
| Primary accent | `#E94560` (hot pink/red) |
| Secondary accent | `#12c2e9` (cyan) |
| Theme | Dark, sci-fi, cinematic |

---

## Super.so Injection Pattern

Every page that embeds these files into Super.so uses one or more of the three injection slots: **Head**, **CSS**, and **Body**.

### Universal Notion Header Suppression

This CSS block appears in nearly every `_css.html` file. It hides Notion's default page icon and title to enable fully custom layouts:

```css
/* Hide icon and title everywhere */
.notion-header__icon,
.notion-header__title,
.notion-page-icon-wrapper,
.notion-page-title {
  display: none !important;
}

/* Collapse the entire header space */
.notion-header,
.super-content > div:first-child {
  display: none !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
}
```

**When adding CSS for a new page that hides the Notion header, copy this block exactly.**

---

## Animation Conventions

### acker.cloud animations
- `ctaPulse` — CTA button glow pulse (2.8s ease-in-out infinite)
- `bounce` — scroll chevron bounce (2s infinite)
- `blobMove` — hero background radial gradient drift (18s ease-in-out infinite alternate)

### thrivecmd.com animations
- `scanlines-move` — moving horizontal scanlines (3s linear infinite)
- `blip-float` — floating glow orbs (6s ease-in-out infinite alternate)
- `spaceDrift` — background star drift (120s linear infinite)
- `starsTwinkle` — secondary star layer (100s linear infinite)
- `floatOrb` — nebula orb float (40s ease-in-out alternate)
- `floatConstellation` — corner constellation bob (30s ease-in-out infinite)

---

## Responsive Breakpoints

Both sites use `max-width: 768px` as the primary mobile breakpoint, with some thrivecmd pages also using `max-width: 600px`.

---

## Working with Images

Images live in `acker_cloud/img/`. Formats in use:
- `.jpeg` — photographs (profile photo)
- `.avif` — logos and brand marks (preferred for quality/size)

When referencing images in HTML files, always use the jsDelivr CDN URL (not a relative path), since the HTML snippets are injected into Super.so:

```html
<img src="https://cdn.jsdelivr.net/gh/zacker3310/brand@main/acker_cloud/img/acker.jpeg" alt="Zac Acker">
```

---

## Adding a New Page

1. Create a subdirectory under the appropriate site folder: `acker_cloud/{page}/` or `thrivecmd/{page}/`
2. Create the files you need following the `{page}_{type}.html` naming convention
3. Include the Notion header suppression block in any `_css.html` file
4. Use the site's design tokens/fonts (Inter for acker.cloud, Orbitron for thrivecmd)
5. Wrap `<style>` content in `<style>` tags, body content in `<body>` tags, head content in `<head>` tags

---

## Git Conventions

- Default development branch: `master` / `main`
- Feature/AI branches follow: `claude/{description}-{id}` pattern
- Commit messages are short and descriptive: `Create home_css.html`, `Update README.md`
- No CI/CD pipelines — changes go live after pushing to `main` (CDN propagation delay applies)

---

## External Dependencies

| Resource | URL | Used by |
|---|---|---|
| Inter font | `fonts.googleapis.com` | acker.cloud |
| Orbitron font | `fonts.googleapis.com` | thrivecmd.com |
| Pillars of Creation BG | `cdn.spacetelescope.org/archives/images/screen/heic2226a.jpg` | thrivecmd site_css, numinous |
| Stardust texture | `www.transparenttextures.com/patterns/stardust.png` | ignition_protocol |
| Starfield image | `cdn.jsdelivr.net/gh/matttproud/starfield/starfield.png` | ignition_protocol |
