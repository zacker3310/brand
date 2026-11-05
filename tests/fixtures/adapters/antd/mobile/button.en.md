# Button

Used to start an immediate operation.

## When to Use

Marks or encapsulates a group of operation commands, responds to user click behavior, and triggers corresponding business logic.

## Demos

<code src="./demos/demo1.tsx"></code>

## Button

### Props

| Name | Description | Type | Default |
| --- | --- | --- | --- |
| color | The color of the button. | `'default' \| 'primary' \| 'success' \| 'warning' \| 'danger'` | `'default'` |
| disabled | Should the button be disabled. | `boolean` | `false` |
| fill | The fill mode. | `'solid' \| 'outline' \| 'none'` | `'solid'` |
| size | The size of the button. | `'mini' \| 'small' \| 'middle' \| 'large'` | `'middle'` |
| type | The `type` prop of native `button` element. | `'submit' \| 'reset' \| 'button'` | `'button'` |

### CSS Variables

| Name | Description | Default | Global |
| --- | --- | --- | --- |
| --background-color | Background color of the button. | `var(--adm-color-background)` | `--adm-button-background-color` |
| --border-radius | Border radius of the button. | `4px` | `--adm-button-border-radius` |
| --gap | Gap between icon and text. | `4px` | - |

### Ref

| Name          | Description           | Type                          |
| ------------- | --------------------- | ----------------------------- |
| nativeElement | Native button element | `HtmlButtonElement` \| `null` |
