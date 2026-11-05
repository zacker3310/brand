---
category: Components
title: Button
description: To trigger an operation.
designUrl: /docs/spec/buttons
demo:
  cols: 2
group:
  title: General
  order: 1
---

## When To Use

A button means an operation (or a series of operations). Clicking a button will trigger its corresponding business logic.

## Examples

<!-- prettier-ignore -->
<code src="./demo/basic.tsx">Syntactic sugar</code>
<code src="./demo/color-variant.tsx" version="5.21.0">Color & Variant</code>
<code src="./demo/debug-color-variant" debug>Debug Color & Variant</code>
<code src="./demo/size.tsx">Size</code>

## API

Common props ref：[Common props](/docs/react/common-props)

| Property | Description | Type | Default | Version | [Global Config](/components/config-provider#component-config) |
| --- | --- | --- | --- | --- | --- |
| block | Option to fit button width to its parent width | boolean | false |  | × |
| color | Set button color | `default` \| `primary` \| `danger` \| [PresetColors](#presetcolors) | `primary` when `variant="solid"` | 5.21.0 | 5.25.0 |
| disabled | Disabled state of button | boolean | false |  | × |
| htmlType | Set the original html `type` of `button`, see: [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#type) | `submit` \| `reset` \| `button` | `button` |  | × |
| ~~iconPosition~~ | Set the icon position of button, please use `iconPlacement` instead | `start` \| `end` | `start` | 5.17.0 | × |
| loading | Set the loading status of button | boolean \| { delay: number, icon: ReactNode } | false | icon: 5.23.0 | × |
| shape | Can be used to set button shape | `default` \| `circle` \| `round` | `default` |  | 5.27.0 |
| size | Set the size of button | `large` \| `medium` \| `small` | `medium` |  | × |
| type | Syntactic sugar. Set button type. Will follow `variant` & `color` if provided | `primary` \| `dashed` \| `link` \| `text` \| `default` | `default` |  | × |
| variant | Set button variant | `outlined` \| `dashed` \| `solid` \| `filled` \| `text` \| `link` | - | 5.21.0 | 5.25.0 |

It accepts all props which native buttons support. See also [Dropdown](/components/dropdown/) and [Space](https://ant.design/components/space#api).

### Common API

<embed src="./shared/sharedProps.en-US.md"></embed>

### Methods

| Name | Description | Type |
| --- | --- | --- |
| focus() | Get focus | () => void |

## Design Token

<ComponentTokenTable component="Button"></ComponentTokenTable>

## FAQ

Screen readers announce the loading state through `aria-busy` on the button element.
