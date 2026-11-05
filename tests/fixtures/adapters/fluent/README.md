# Fluent adapter fixtures

Small, trimmed excerpts of first-party Microsoft sources used by `tests/unit/adapters/fluent.test.ts`.
Code excerpts are MIT licensed (Copyright (c) Microsoft Corporation, https://github.com/microsoft/fluentui/blob/master/LICENSE).

| File | Source |
| --- | --- |
| `react-button.d.ts.txt` | `@fluentui/react-button@9.11.3` `dist/index.d.ts` (selected declarations) plus a Breadcrumb declaration excerpt in the `export { X_2 as X }` form used by `@fluentui/react-breadcrumb` |
| `web-components.d.ts.txt` | `@fluentui/web-components@3.1.4` `dist/web-components.d.ts` (Button, Checkbox, MenuItem; members trimmed) |
| `tokens/lib/**` | `@fluentui/tokens@1.0.0-alpha.24` `lib/` modules, trimmed to a few entries per object but keeping the original code shapes (arrow theme factory, `Array#reduce` palette with template keys, one-off patch, shadow factory) |
| `storybook-react-index.json`, `storybook-wc-index.json` | `https://storybooks.fluentui.dev/{react,web-components}/index.json` (subset of entries) |
| `button-index.stories.tsx.txt`, `dialog-index.stories.tsx.txt`, `*Description.md`, `ButtonBestPractices.md`, `*AccessibilitySpec.mdx` | `microsoft/fluentui` at tag `@fluentui/react-components_v9.75.1` (`packages/react-components/*/stories/src/**`; specs trimmed to intro, Semantics and Keyboard sections) |
| `f2-button-usage.html`, `f2-design-principles.html` | `https://fluent2.microsoft.design` server-rendered HTML (scripts, styles, SVG and unrelated sections removed; navigation island props trimmed to three groups) |

Code-like fixtures use a `.txt` suffix so the project type checker does not compile them.
