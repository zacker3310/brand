# brand

Central brand asset repository for two personal/professional websites, both powered by **Notion + Super.so**.

| Site | Purpose |
|---|---|
| [acker.cloud](https://acker.cloud) | Personal site & resume (Zac Acker) |
| [thrivecmd.com](https://thrivecmd.com) | Content, culture, and side projects (Thrive Culture Media) |

---

## What's in this repo

```
brand/
├── acker_cloud/        # acker.cloud assets
│   ├── img/            # Profile photo, logos
│   ├── home/           # Hero section (head/css/body snippets)
│   ├── contact/        # Contact page snippets
│   ├── portfolio/      # Portfolio page CSS
│   └── wiki/           # Wiki page CSS
└── thrivecmd/          # thrivecmd.com assets
    ├── home/           # Hero section snippets
    ├── numinous/       # Numinous page snippets
    └── ignition_protocol/  # Starfield/space page CSS
```

Each page has up to three injectable snippet files following the `{page}_{type}.html` convention:

| Suffix | Injected into | Contains |
|---|---|---|
| `_head.html` | Super.so "Head" slot | Font imports, root-level styles |
| `_css.html` | Super.so "CSS" slot | Page-scoped `<style>` block |
| `_body.html` | Super.so "Body" slot | HTML markup |

---

## How assets are served

Static files are delivered via **jsDelivr CDN** directly from this repo:

```
https://cdn.jsdelivr.net/gh/zacker3310/brand@main/{path/to/file}
```

To purge the CDN cache after a push:

```
https://purge.jsdelivr.net/gh/zacker3310/brand@main/{path/to/file}
```

---

## Design systems at a glance

### acker.cloud
- **Font:** Inter (Google Fonts)
- **Background:** `#0a0a0a` near-black
- **Accent:** `#EB5757` (Notion Red)
- **Theme:** Dark, minimal, professional

### thrivecmd.com
- **Font:** Orbitron (Google Fonts)
- **Background:** Pillars of Creation cosmic image
- **Accents:** `#E94560` (hot pink) / `#12c2e9` (cyan)
- **Theme:** Dark, sci-fi, cinematic

---

## No build system

There is no bundler, package manager, or JavaScript framework. Everything is plain HTML and CSS. Changes go live after pushing to `main` (CDN propagation delay applies).

For a full reference on conventions, animations, breakpoints, and how to add new pages, see [CLAUDE.md](./CLAUDE.md).
