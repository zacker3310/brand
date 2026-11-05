# useButton

Provides the behavior and accessibility implementation for a button component. Handles mouse,
keyboard, and touch interactions, focus behavior, and ARIA props for both native button elements
and custom element types.

```tsx
import {Button} from 'hooks-starter/Button';

<Button onPress={() => alert('Button pressed!')}>Press me</Button>
```

## API

<FunctionAPI
  function={docs.exports.useButton}
  links={docs.links}
/>

### AriaButtonProps

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `elementType` | `JSXElementConstructor<any> | T | undefined` | 'button' | The HTML element or React element used to render the button, e.g. 'div', 'a', or `RouterLink`. |
| `isDisabled` | `boolean | undefined` | — | Whether the button is disabled. |
| `onClick` | `((e: MouseEvent<FocusableElement>) => void) | undefined` | — | **Not recommended – use `onPress` instead.** `onClick` is an alias for `onPress` provided for compatibility with other libraries. `onPress` provides additional event details for non-mouse interactions. |
| `onPress` | `((e: PressEvent) => void) | undefined` | — | Handler that is called when the press is released over the target. |
| `type` | `"button" | "reset" | "submit" | undefined` | 'button' | The behavior of the button when used in an HTML form. |

### ButtonAria

| Name | Type | Description |
|------|------|-------------|
