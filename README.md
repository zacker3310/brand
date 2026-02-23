# brand

Central repository for brand assets, custom CSS, and HTML snippets powering two sites:

- **[acker.cloud](https://acker.cloud)** — Personal site & resume
- **[thrivecmd.com](https://thrivecmd.com)** — Content, culture, and side projects

Both sites run on **Notion + Super.so**. Files here are injected as custom Head/CSS/Body snippets per page, and static assets are served via jsDelivr CDN.

---

## Structure

```
brand/
├── acker_cloud/
│   ├── img/                   profile photo, logos (.jpeg, .avif)
│   ├── home/                  hero section (head + CSS + body)
│   ├── contact/               contact section (CSS + body)
│   ├── portfolio/             Notion header suppression CSS
│   └── wiki/                  Notion header suppression CSS
│
└── thrivecmd/
    ├── site_css.html          global Pillars of Creation background
    ├── home/                  hero section with scanlines/blips
    ├── numinous/              cosmic background (div-based)
    └── ignition_protocol/     starfield/space animations
```

Each page directory contains up to three files following the `{page}_{type}.html` convention:

| File | Injected into |
|---|---|
| `{page}_head.html` | Super.so **Head** — font imports, root styles |
| `{page}_css.html` | Super.so **CSS** — page-scoped styles |
| `{page}_body.html` | Super.so **Body** — custom HTML markup |

---

## CDN Delivery

All files are served live from this repo via jsDelivr:

```
https://cdn.jsdelivr.net/gh/zacker3310/brand@main/{path/to/file}
```

After pushing to `main`, purge the CDN cache if you need changes reflected immediately:

```
https://purge.jsdelivr.net/gh/zacker3310/brand@main/{path/to/file}
```

---

## Design Tokens

### acker.cloud
- **Font:** Inter
- **Background:** `#0a0a0a` / `#0d0d0d`
- **Accent:** `#EB5757` (Notion Red) / `#C63D3D`
- **Theme:** Dark, minimal, professional

### thrivecmd.com
- **Font:** Orbitron
- **Background:** Pillars of Creation (ESA photo, fixed)
- **Accent:** `#E94560` (pink-red) + `#12c2e9` (cyan)
- **Theme:** Dark, sci-fi, cinematic

---

## Development

There is no build step — everything is plain HTML and CSS. To work on a page:

1. Edit the relevant `_head.html`, `_css.html`, or `_body.html` file
2. Push to `main`
3. Copy the raw file content into the matching Super.so injection slot for that page
4. Purge the jsDelivr cache for any updated static assets

See [CLAUDE.md](./CLAUDE.md) for full conventions, animation names, and patterns used across the codebase.
