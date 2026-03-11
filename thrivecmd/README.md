# thrivecmd.com

Brand assets for **thrivecmd.com** — content, culture, and side projects (Thrive Culture Media).
Powered by Notion + Super.so.

## Live Site

https://thrivecmd.com

---

## Design System

| Property | Value |
|---|---|
| Font | Orbitron (Google Fonts) |
| Background | Pillars of Creation cosmic image (ESA CDN) |
| Primary accent | `#E94560` (hot pink/red) |
| Secondary accent | `#12c2e9` (cyan) |
| Theme | Dark, sci-fi, cinematic |

---

## Directory Structure

```
thrivecmd/
├── site_css.html              # Global CSS — Pillars of Creation fixed background
├── home/
│   ├── home_head.html         # Orbitron font import
│   ├── home_css.html          # Hero CSS (scanlines + floating blips)
│   └── home_body.html         # Hero section HTML
├── numinous/
│   ├── numinous_css.html      # Pillars of Creation background (div-based)
│   └── numinous_body.html     # #pillars-bg div element
└── ignition_protocol/
    └── ignition_protocol_css.html  # Starfield/space CSS with animations
```

---

## Pages

### Home (`home/`)
The landing page hero section. Features animated scanlines and floating glow orbs over the cosmic background.

### Numinous (`numinous/`)
A page-specific implementation of the Pillars of Creation background using a positioned `<div>` rather than a CSS background property.

### Ignition Protocol (`ignition_protocol/`)
A space-themed page with animated starfield layers, drifting nebula orbs, and constellation accents.

---

## Key Animations

| Name | Description | Duration |
|---|---|---|
| `scanlines-move` | Moving horizontal scanlines | 3s linear infinite |
| `blip-float` | Floating glow orbs | 6s ease-in-out infinite alternate |
| `spaceDrift` | Background star drift | 120s linear infinite |
| `starsTwinkle` | Secondary star layer | 100s linear infinite |
| `floatOrb` | Nebula orb float | 40s ease-in-out alternate |
| `floatConstellation` | Corner constellation bob | 30s ease-in-out infinite |

---

## External Dependencies

| Resource | URL |
|---|---|
| Orbitron font | `fonts.googleapis.com` |
| Pillars of Creation BG | `cdn.spacetelescope.org/archives/images/screen/heic2226a.jpg` |
| Stardust texture | `www.transparenttextures.com/patterns/stardust.png` |
| Starfield image | `cdn.jsdelivr.net/gh/matttproud/starfield/starfield.png` |

---

## CDN Delivery

All files in this directory are served via jsDelivr CDN:

```
https://cdn.jsdelivr.net/gh/zacker3310/brand@main/thrivecmd/{path/to/file}
```

To purge the cache after a push to `main`:

```
https://purge.jsdelivr.net/gh/zacker3310/brand@main/thrivecmd/{path/to/file}
```
