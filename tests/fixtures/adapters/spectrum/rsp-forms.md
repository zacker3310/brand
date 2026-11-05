# Forms

Learn how to integrate with HTML forms, validate and submit data, and use React Spectrum with form libraries.

## Labels and help text

Accessible forms start with clear, descriptive labels for each field. Use the `label` prop to add a visible label to any field. Additional help text can also be added via the `description` prop. The label and help text are announced by screen readers when the field is focused.

```tsx
import {TextField} from '@react-spectrum/s2/TextField';

<TextField
  type="password"
  label="Password"
  placeholder="Choose a password"
  description="Password must be at least 8 characters." />
```

Most fields should have a visible label. In rare exceptions, the `aria-label` or `aria-labelledby` attribute must be provided for assistive technologies.

## Submitting data

How you submit form data depends on your framework, application, and server. By default, HTML forms are submitted by the browser using a full page refresh. You can take control of form submission using the `action` prop or `onSubmit` event.

### Uncontrolled forms

When using React 19, use the `action` prop to handle form submission. This receives a [FormData](https://developer.mozilla.org/en-US/docs/Web/API/FormData) object containing the values for each form field. In React 18 or earlier, use the `onSubmit` event instead.

## React 19 example

```tsx
import {Form} from '@react-spectrum/s2/Form';
import {TextField} from '@react-spectrum/s2/TextField';
import {Button} from '@react-spectrum/s2/Button';

<Form
  /*- begin highlight -*/
  action={formData => {
    let name = formData.get('name');
    alert(`Hello, ${name}!`);