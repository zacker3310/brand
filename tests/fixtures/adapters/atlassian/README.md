Trimmed structural fixtures for the Atlassian adapter unit tests.

The HTML files keep only the DOM structure the parsers rely on (atlassian.design side navigation,
`#main-content` header, tablist, tab panel, "Copy link" heading wrappers, installation table and
generated props tables) with a few short text excerpts; styles, scripts, SVG and class names are
removed. The token artifacts are a handful of entries from `@atlaskit/tokens` codegen output; npm
metadata and llms-components.txt are reduced to the fields read by the adapter.

Source: Atlassian Design System (https://atlassian.design), (c) Atlassian. Used here only as minimal
test fixtures for static parsing; see https://atlassian.design/license.
