# ComboBox

A combo box combines a text input with a listbox, allowing users to filter a list of options to
items matching a query.

## Vanilla CSS example

```tsx
import {ComboBox} from 'vanilla-starter/ComboBox';
```

## Content

`ComboBox` reuses the `ListBox` component, following the [Collection Components API](collections.md?component=ComboBox). It supports ListBox features such as static and dynamic collections, sections, disabled items, links, text slots, asynchronous loading, etc. See the [ListBox docs](ListBox.md) for more details.

The following example shows a dynamic collection of items, grouped into sections.

```tsx
import {ComboBox, ComboBoxItem} from 'vanilla-starter/ComboBox';
import {ListBoxSection, Header} from 'vanilla-starter/ListBox';
import {Collection} from 'react-aria-components/Collection';

function Example() {
  /*- begin collapse -*/
  let options = [
    {name: 'Fruit', children: [
      {name: 'Apple'},
      {name: 'Banana'},
      {name: 'Orange'},
      {name: 'Honeydew'},
      {name: 'Grapes'},
      {name: 'Watermelon'},
      {name: 'Cantaloupe'},
      {name: 'Pear'}
    ]},
    {name: 'Vegetable', children: [
      {name: 'Cabbage'},
      {name: 'Broccoli'},
      {name: 'Carrots'},
      {name: 'Lettuce'},
      {name: 'Spinach'},
      {name: 'Bok Choy'},
      {name: 'Cauliflower'},
      {name: 'Potatoes'}
    ]}
  ];
  /*- end collapse -*/

  return (
    /*- begin highlight -*/
    <ComboBox
      label="Preferred fruit or vegetable"
      placeholder="Select an option"
      defaultItems={options}>
      {section => (
        <ListBoxSection id={section.name}>
          <Header>{section.name}</Header>
          <Collection items={section.children}>
            {item => <ComboBoxItem id={item.name}>{item.name}</ComboBoxItem>}
          </Collection>
        </ListBoxSection>
      )}
    </ComboBox>
    /*- end highlight -*/
  );
}
```

## API

```tsx
<ComboBox>
  <Label />
  <Group>
    <Input />
    <Button />
  </Group>
  <ComboBoxValue />
  <Text slot="description" />
  <FieldError />
  <Popover>
    <ListBox />
  </Popover>
</ComboBox>
```

### ComboBox

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `allowsCustomValue` | `boolean | undefined` | — | Whether the ComboBox allows a non-item matching input value to be set. |
| `formValue` | `"key" | "text" | undefined` | 'key' | Whether the text or key of the selected item is submitted as part of an HTML form. When `allowsCustomValue` is `true`, this option does not apply and the text is always submitted. |
| `isDisabled` | `boolean | undefined` | — | Whether the input is disabled. |
| `isInvalid` | `boolean | undefined` | — | Whether the input value is invalid. |
| `isRequired` | `boolean | undefined` | — | Whether user input is required on the input before form submission. |
| `menuTrigger` | `MenuTriggerAction | undefined` | 'input' | The interaction required to display the ComboBox menu. |
| `onInputChange` | `((value: string) => void) | undefined` | — | Handler that is called when the ComboBox input value changes. |
| `onPointerDown` | `React.PointerEventHandler<HTMLDivElement> | undefined` | — |  |
| `validate` | `((value: ComboBoxValidationValue<M>) => true | undefined) | ValidationError | null | undefined` | — | A function that returns an error message if a given value is invalid. Validation errors are displayed to the user when the form is submitted if `validationBehavior="native"`. For realtime validation, use the `isInvalid` prop instead. |

### ComboBoxValue

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `onPointerDown` | `React.PointerEventHandler<HTMLElement> | undefined` | — |  |
