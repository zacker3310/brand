<!-- Trimmed test fixture from material-components/material-web@v2.5.0 (Apache-2.0, Copyright Google LLC). -->
<!-- catalog-only-start --><!-- ---
name: Buttons
dirname: button
-----><!-- catalog-only-end -->

<catalog-component-header>
<catalog-component-header-title slot="title">

# Buttons

<!-- no-catalog-start -->

<!--*
# Document freshness: For more information, see go/fresh-source.
freshness: { owner: 'lizmitchell' reviewed: '2025-11-23' }
tag: 'docType:reference'
*-->

<!-- go/md-button -->

<!-- [TOC] -->

<!-- external-only-start -->
**This documentation is fully rendered on the
[Material Web catalog](https://material-web.dev/components/button/).**
<!-- external-only-end -->

<!-- no-catalog-end -->

[Buttons](https://m3.material.io/components/buttons)<!-- {.external} --> help people
initiate actions, from sending an email, to sharing a document, to liking a
post.

There are five types of common buttons: elevated, filled, filled tonal,
outlined, and text.

</catalog-component-header-title>

<img
    class="hero"
    alt="A phone showing a payment screen with a green filled button that says 'Make
payment'"
    title="There are 5 types of common buttons"
    src="images/button/hero.webp">

</catalog-component-header>

*   [Design article](https://m3.material.io/components/buttons) <!-- {.external} -->
*   [API Documentation](#api)
*   [Source code](https://github.com/material-components/material-web/tree/main/button)
    <!-- {.external} -->

<!-- catalog-only-start -->

<!--

## Interactive Demo

{% playgroundexample dirname=dirname %}

-->

<!-- catalog-only-end -->

## Types

<!-- no-catalog-start -->

![The 5 types of common buttons](images/button/types.webp "Elevated, filled, filled tonal, outlined, and text buttons")

<!-- no-catalog-end -->
<!-- catalog-only-start -->

<!--

<div class="figure-wrapper">
  <figure
      class="types-image"
      style="justify-content:center;"
      title="Elevated, filled, filled tonal, outlined, and text buttons"
      aria-label="The 5 types of common buttons">
    <style>
      .types-image .wrapper,
      .types-image .wrapper > * {
        display: flex;
        padding: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }
      .types-image .wrapper > * {
        flex-direction: column;
        align-items: center;
        padding-inline: 16px;
      }
      .types-image span {
        display: inline-flex;
        background-color: var(--md-sys-color-inverse-surface);
        color: var(--md-sys-color-inverse-on-surface);
        padding: 8px;
        margin-block-start: 8px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        justify-content: center;
        align-items: center;
      }
    </style>
    <div class="wrapper">
      <div>
        <md-elevated-button has-icon>
          <md-icon slot="icon">add</md-icon>
          Elevated
        </md-elevated-button>
        <span>1</span>
      </div>
      <div>
        <md-filled-button>Filled</md-filled-button>
        <span>2</span>
      </div>
      <div>
        <md-filled-tonal-button>Tonal</md-filled-tonal-button>
        <span>3</span>
      </div>
      <div>
        <md-outlined-button>Outlined</md-outlined-button>
        <span>4</span>
      </div>
      <div>
        <md-text-button>Text</md-text-button>
        <span>5</span>
      </div>
    </div>
  </figure>
</div>

-->

<!-- catalog-only-end -->

1.  [Elevated button](#elevated-button)
1.  [Filled button](#filled-button)

## Usage

Buttons have label text that describes the action that will occur if a user taps
a button.

<!-- no-catalog-start -->

![An outlined button with the text "Back" next to a filled button with the text
"Complete"](images/button/usage.webp "Outlined and filled buttons.")

<!-- no-catalog-end -->
<!-- catalog-only-start -->

<!--

<div class="figure-wrapper">
  <figure
      style="justify-content:center;gap: 8px;"
      title="Outlined and filled buttons."
      aria-label="An outlined button with the text 'Back' next to a filled button with the text 'Complete'">
    <md-outlined-button>Back</md-outlined-button>
    <md-filled-button>Complete</md-filled-button>
  </figure>
</div>

-->

<!-- catalog-only-end -->

```html
<md-outlined-button>Back</md-outlined-button>
<md-filled-button>Complete</md-filled-button>
```

### Icon

An icon may optionally be added to a button to help communicate the button's
action and help draw attention.

<!-- no-catalog-start -->

![A tonal button with a right arrow send icon with text 'send' and a text button
with the text 'open' with a trailing icon arrow
box](images/button/usage-icon.webp "Slot in icons to the appropriate slots")

<!-- no-catalog-end -->
<!-- catalog-only-start -->

<!--

<div class="figure-wrapper">
  <figure
      style="justify-content:center;gap: 8px;"
      title="Outlined and filled buttons."
      aria-label="An outlined button with the text 'Back' next to a filled button with the text 'Complete'">
    <md-filled-tonal-button>
      Send
      <svg slot="icon" viewBox="0 0 48 48"><path d="M6 40V8l38 16Zm3-4.65L36.2 24 9 12.5v8.4L21.1 24 9 27Zm0 0V12.5 27Z"/></svg>
    </md-filled-tonal-button>

    <md-text-button trailing-icon>
      Open
      <svg slot="icon" viewBox="0 0 48 48"><path d="M9 42q-1.2 0-2.1-.9Q6 40.2 6 39V9q0-1.2.9-2.1Q7.8 6 9 6h13.95v3H9v30h30V25.05h3V39q0 1.2-.9 2.1-.9.9-2.1.9Zm10.1-10.95L17 28.9 36.9 9H25.95V6H42v16.05h-3v-10.9Z"/></svg>
    </md-text-button>
  </figure>
</div>

-->

<!-- catalog-only-end -->

```html
<md-filled-tonal-button>
  Send
  <svg slot="icon" viewBox="0 0 48 48"><path d="M6 40V8l38 16Zm3-4.65L36.2 24 9 12.5v8.4L21.1 24 9 27Zm0 0V12.5 27Z"/></svg>
</md-filled-tonal-button>

<md-text-button trailing-icon>
  Open
  <svg slot="icon" viewBox="0 0 48 48"><path d="M9 42q-1.2 0-2.1-.9Q6 40.2 6 39V9q0-1.2.9-2.1Q7.8 6 9 6h13.95v3H9v30h30V25.05h3V39q0 1.2-.9 2.1-.9.9-2.1.9Zm10.1-10.95L17 28.9 36.9 9H25.95V6H42v16.05h-3v-10.9Z"/></svg>
</md-text-button>
```

## Accessibility

Add an
[`aria-label`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-label)<!-- {.external} -->
attribute to buttons whose labels need a more descriptive label.

```html
<md-elevated-button aria-label="Add a new contact">Add</md-elevated-button>
```

### Focusable and disabled

By default, disabled buttons are not focusable with the keyboard, while
"soft-disabled" buttons are. Some use cases encourage focusability of disabled
toolbar items to increase their discoverability.

See the
[ARIA guidelines on focusability of disabled controls](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_disabled_controls)<!-- {.external} -->
for guidance on when this is recommended.

```html
<div role="toolbar">
  <md-text-button>Copy</md-text-button>
  <md-text-button>Cut</md-text-button>
  <!--
    This button is disabled but kept focusable to improve its discoverability
    in the toolbar.
  -->
  <md-text-button soft-disabled>Paste</md-text-button>
</div>
```

## Elevated button

<!-- go/md-elevated-button -->

[Elevated buttons](https://m3.material.io/components/buttons/guidelines#4e89da4d-a8fa-4e20-bb8d-b8a93eff3e3e)<!-- {.external} -->
are essentially filled tonal buttons with a shadow. To prevent shadow creep,
only use them when absolutely necessary, such as when the button requires visual
separation from a patterned background.

<!-- no-catalog-start -->

![An elevated button](images/button/usage-elevated-button.webp)

<!-- no-catalog-end -->
<!-- catalog-only-start -->

<!--

<div class="figure-wrapper">
  <figure
      style="justify-content:center;align-items:center;"
      aria-label="An elevated button.">
    <md-elevated-button>Elevated</md-elevated-button>
  </figure>
</div>

-->

<!-- catalog-only-end -->

```html
<md-elevated-button>Elevated</md-elevated-button>
```

## Filled button

<!-- go/md-filled-button -->

[Filled buttons](https://m3.material.io/components/buttons/guidelines#9ecffdb3-ef29-47e7-8d5d-f78b404fcafe)<!-- {.external} -->
have the most visual impact after the FAB, and should be used for important,
final actions that complete a flow, like Save, Join now, or Confirm.

<!-- no-catalog-end -->
<!-- catalog-only-start -->

<!--

<div class="figure-wrapper">
  <figure
      style="justify-content:center;align-items:center;"
      aria-label="A filled button.">
    <md-filled-button>Filled</md-filled-button>
  </figure>
</div>

-->

<!-- catalog-only-end -->

```html
<md-filled-button>Filled</md-filled-button>
```

## Theming

Button supports [Material theming](../theming/README.md) and can be customized
in terms of color, typography, and shape.

### Elevated button tokens

Token                                   | Default value
--------------------------------------- | -------------------------------------
`--md-elevated-button-container-color`  | `--md-sys-color-surface`
`--md-elevated-button-container-shape`  | `--md-sys-shape-corner-full`
`--md-elevated-button-label-text-color` | `--md-sys-color-on-surface`
`--md-elevated-button-label-text-font`  | `--md-sys-typescale-label-large-font`

*   [All tokens](https://github.com/material-components/material-web/blob/main/tokens/_md-comp-elevated-button.scss)
    <!-- {.external} -->

### Filled button tokens

Token                                 | Default value
------------------------------------- | -------------------------------------
`--md-filled-button-container-color`  | `--md-sys-color-primary`
`--md-filled-button-container-shape`  | `--md-sys-shape-corner-full`
`--md-filled-button-label-text-color` | `--md-sys-color-on-primary`
`--md-filled-button-label-text-font`  | `--md-sys-typescale-label-large-font`

*   [All tokens](https://github.com/material-components/material-web/blob/main/tokens/_md-comp-filled-button.scss)
    <!-- {.external} -->

<!-- auto-generated API docs start -->

## API


### MdElevatedButton <code>&lt;md-elevated-button&gt;</code>

#### Properties

<!-- mdformat off(autogenerated might break rendering in catalog) -->

| Property | Attribute | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `softDisabled` | `soft-disabled` | `boolean` | `false` | Whether or not the button is "soft-disabled" (disabled but still focusable).<br>Use this when a button needs increased visibility when disabled. See https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_disabled_controls for more guidance on when this is needed. |
| `href` | `href` | `string` | `''` | The URL that the link button points to. |
| `download` | `download` | `string` | `''` | The filename to use when downloading the linked resource. If not specified, the browser will determine a filename. This is only applicable when the button is used as a link (`href` is set). |
| `target` | `target` | `"" \| "_blank" \| "_parent" \| "_self" \| "_top"` | `''` | Where to display the linked `href` URL for a link button. Common options include `_blank` to open in a new tab. |

<!-- mdformat on(autogenerated might break rendering in catalog) -->

### MdFilledButton <code>&lt;md-filled-button&gt;</code>

#### Properties

<!-- mdformat off(autogenerated might break rendering in catalog) -->

| Property | Attribute | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `softDisabled` | `soft-disabled` | `boolean` | `false` | Whether or not the button is "soft-disabled" (disabled but still focusable).<br>Use this when a button needs increased visibility when disabled. See https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_disabled_controls for more guidance on when this is needed. |
| `href` | `href` | `string` | `''` | The URL that the link button points to. |
| `download` | `download` | `string` | `''` | The filename to use when downloading the linked resource. If not specified, the browser will determine a filename. This is only applicable when the button is used as a link (`href` is set). |

<!-- mdformat on(autogenerated might break rendering in catalog) -->

<!-- auto-generated API docs end -->
