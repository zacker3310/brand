# GOV.UK adapter fixtures

Short, trimmed excerpts of real GOV.UK Design System sources, used by `tests/unit/adapters/govuk.test.ts`
(no network access in tests).

| Fixture | Source |
|---|---|
| `button-index.md`, `exit-this-page-index.md`, `feedback-index.md`, `addresses-index.md`, `start-pages-index.md`, `lifecycle.md`, `colours.json`, `index.njk` | alphagov/govuk-design-system (main): `src/components/*/index.md`, `src/patterns/*/index.md`, `src/community/component-lifecycle-statuses/index.md`, `data/colours.json`, `src/index.njk` |
| `button.yaml`, `input.yaml` | alphagov/govuk-frontend v6.6.0: `packages/govuk-frontend/src/govuk/components/*/*.yaml` |
| `input-macro-options.json`, `*-template.njk`, `button-mixin.scss`, `button-_settings.scss`, `button-template-default.html`, `tabs.mjs`, `all.mjs`, `govuk-prototype-kit.config.json`, `hint-README.md`, `_*.scss`, `listing.json` | govuk-frontend@6.6.0 npm package (via jsDelivr; `listing.json` is a trimmed jsDelivr flat listing) |
| `sitemap.xml` | design-system.service.gov.uk/sitemap.xml (trimmed) |
| `government-design-principles.json` | GOV.UK Content API `/api/content/guidance/government-design-principles` (trimmed) |

Licences: govuk-frontend and govuk-design-system code are MIT (© Crown copyright, Government Digital
Service); GOV.UK content is available under the Open Government Licence v3.0.
