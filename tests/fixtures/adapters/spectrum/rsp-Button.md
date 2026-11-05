# Button

Buttons allow users to perform an action.
They have multiple styles for various needs, and are ideal for calling attention to
where a user needs to do something in order to move forward in a flow.

```tsx
import {Button} from '@react-spectrum/s2/Button';

<Button />
```

## Events

Use the `onPress` prop to handle interactions via mouse, keyboard, and touch. The `onPressStart`, `onPressEnd`, and `onPressChange` events are also emitted as the user interacts with the button.

```tsx
import {Button} from '@react-spectrum/s2/Button';
import {useState} from 'react';

function Example() {
  let [count, setCount] = useState(0);

  return (
    /*- begin highlight -*/
    <Button onPress={() => setCount(c => c + 1)}>
      {/*- end highlight -*/}
      {`${count} Edits`}
    </Button>
  );
}
```

## Pending

Use the `isPending` prop to display a pending state. Pending buttons remain focusable, but are otherwise disabled. After a 1 second delay, an indeterminate spinner will be displayed in place of the button label and icon.

```tsx
import {Button} from '@react-spectrum/s2/Button';
import {useState} from 'react';

function PendingButton() {
  let [isPending, setPending] = useState(false);

  return (
    <Button
      variant="primary"
      isPending={isPending}
      onPress={() => {
        setPending(true);
        setTimeout(() => {
          setPending(false);
        }, 5000);
      }}>
      Save
    </Button>
  );
}
```

## API

```tsx
<Button>
  <Icon />
  <Text />
</Button>
```

### Button

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `aria-current` | `boolean | "true" | "false" | "date" | "location" | "page" | "step" | "time" | undefined` | — | Indicates whether this element represents the current item within a container or set of related elements. |
| `children` | `ReactNode` | — | The content to display in the Button. |
| `fillStyle` | `"fill" | "outline" | undefined` | 'fill' | The background style of the Button. |
| `isDisabled` | `boolean | undefined` | — | Whether the button is disabled. |
| `isPending` | `boolean | undefined` | — | Whether the button is in a pending state. This disables press and hover events while retaining focusability, and announces the pending state to screen readers. |
| `onPress` | `((e: PressEvent) => void) | undefined` | — | Handler that is called when the press is released over the target. |
| `size` | `"L" | "M" | "S" | "XL" | undefined` | 'M' | The size of the Button. |
| `variant` | `"accent" | "genai" | "negative" | "premium" | "primary" | "secondary" | undefined` | 'primary' | The [visual style](https://spectrum.adobe.com/web/rsp/components/button#component-options) of the button. |
