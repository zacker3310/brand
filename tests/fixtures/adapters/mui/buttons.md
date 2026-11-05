---
productId: material-ui
title: React Button component
components: Button, IconButton, ButtonBase
materialDesign: https://m2.material.io/components/buttons
githubLabel: 'scope: button'
waiAria: https://www.w3.org/WAI/ARIA/apg/patterns/button/
githubSource: packages/mui-material/src/Button
---

# Button

<p class="description">Buttons allow users to take actions, and make choices, with a single tap.</p>

Buttons communicate actions that users can take. They are typically placed throughout your UI, in places like:

- Modal windows
- Forms
- Cards
- Toolbars

{{"component": "@mui/internal-core-docs/ComponentLinkHeader"}}

## Basic button

The `Button` comes with three variants: text (default), contained, and outlined.

{{"demo": "BasicButtons.js"}}

### Text button

[Text buttons](https://m2.material.io/components/buttons#text-button)
are typically used for less-pronounced actions, including those located: in dialogs, in cards.
In cards, text buttons help maintain an emphasis on card content.

{{"demo": "TextButtons.js"}}

### Contained button

[Contained buttons](https://m2.material.io/components/buttons#contained-button)
are high-emphasis, distinguished by their use of elevation and fill.
They contain actions that are primary to your app.

{{"demo": "ContainedButtons.js"}}

You can remove the elevation with the `disableElevation` prop.

{{"demo": "DisableElevation.js"}}

### Outlined button

[Outlined buttons](https://m2.material.io/components/buttons#outlined-button) are medium-emphasis buttons.
They contain actions that are important but aren't the primary action in an app.

Outlined buttons are also a lower emphasis alternative to contained buttons,
or a higher emphasis alternative to text buttons.

{{"demo": "OutlinedButtons.js"}}

## Sizes

For larger or smaller buttons, use the `size` prop.

{{"demo": "ButtonSizes.js"}}

## Icon button

Icon buttons are commonly found in app bars and toolbars.

Icons are also appropriate for toggle buttons that allow a single choice to be selected or
deselected, such as adding or removing a star to an item.

{{"demo": "IconButtons.js"}}

### Sizes

For larger or smaller icon buttons, use the `size` prop.

{{"demo": "IconButtonSizes.js"}}

