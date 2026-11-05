---
title: Button
description: >-
  The button component triggers actions or events, such as submitting forms,
  opening dialogs, or navigating to other pages. Use button to let users perform
  specific tasks or initiate interactions throughout the interface.
api_version: v2.0
source_url:
  html: 'https://shopify.dev/docs/api/app-home/latest/web-components/actions/button'
  md: >-
    https://shopify.dev/docs/api/app-home/latest/web-components/actions/button.md
api_name: app-home
---

# Button

The button component triggers actions or events, such as submitting forms, opening dialogs, or navigating to other pages. Use button to let users perform specific tasks or initiate interactions throughout the interface.

Buttons support various visual styles, tones, and interaction patterns to communicate intent and hierarchy. They can also function as links, guiding users to internal or external destinations. For navigation-focused interactions within text, use [link](https://shopify.dev/docs/api/app-home/latest/web-components/actions/link). For grouping multiple related buttons, use [button group](https://shopify.dev/docs/api/app-home/latest/web-components/actions/button-group).

#### Use cases

* **Form submission:** Create submit buttons for forms that save product configurations or settings.
* **Primary actions:** Implement primary actions like "Save changes," "Create resource," or "Apply settings."
* **Secondary actions:** Provide supporting actions such as "Cancel," "Reset," or "View details."
* **Loading states:** Show loading indicators during API calls while preventing duplicate submissions.

```html
<s-button>Button</s-button>
```

***

## Properties

Configure the following properties on the button component.

* **accessibility​Label**

  **string**

  A label that describes the purpose or content of the component for assistive technologies like screen readers. Use this to provide additional context when the visible content alone doesn't clearly convey the component's purpose.

* **disabled**

  **boolean**

  **Default: false**

  Whether the button is disabled, preventing it from being clicked or receiving focus.

* **loading**

  **boolean**

  **Default: false**

  Whether to replace the button content with a loading indicator while a background action is being performed.

  This also disables the button component.

* **tone**

  **"auto" | "neutral" | "critical"**

  **Default: 'auto'**

  The semantic meaning and color treatment of the component.

  * `critical`: Urgent problems or destructive actions.
  * `auto`: Automatically determined based on context.
  * `neutral`: General information without specific intent.

* **variant**

  **"auto" | "primary" | "secondary" | "tertiary"**

  **Default: 'auto'**

  The visual appearance of the button component.

  * `auto`: The variant is automatically determined by the button component's context.
  * `primary`: High emphasis button for the primary action on the page. Should be used sparingly.
  * `secondary`: Medium emphasis button for secondary actions.
  * `tertiary`: Low emphasis button for less important actions.

### AnyString

A utility type that enables autocomplete for specific string literals while still accepting any string value. By intersecting \`string\` with an empty object type, this prevents TypeScript from widening literal types, preserving IDE suggestions for known values while maintaining flexibility for custom strings.

```ts
string & {}
```


### Events

The button component provides event callbacks for handling user interactions. Learn more about [handling events](https://shopify.dev/docs/api/polaris/using-polaris-web-components#handling-events).

* **blur**

  **CallbackEventListener\<TTagName> | null**

  A callback fired when the button loses focus.

  Learn more about the [blur event](https://developer.mozilla.org/en-US/docs/Web/API/Element/blur_event).

* **click**

  **CallbackEventListener\<TTagName> | null**

  A callback fired when the button is clicked.

  Learn more about the [click event](https://developer.mozilla.org/en-US/docs/Web/API/Element/click_event).

* **focus**

  **CallbackEventListener\<TTagName> | null**

  A callback fired when the button receives focus.

  Learn more about the [focus event](https://developer.mozilla.org/en-US/docs/Web/API/Element/focus_event).

### CallbackEventListener

A function that handles events from UI components. This type represents an event listener callback that receives a \`CallbackEvent\` with a strongly-typed \`currentTarget\`. Use this for component event handlers like \`click\`, \`focus\`, \`blur\`, and other DOM events.

```ts
(EventListener & {
      (event: CallbackEvent<T>): void;
    }) | null
```

### CallbackEvent

An event object with a strongly-typed \`currentTarget\` property that references the specific HTML element that triggered the event. This type extends the standard DOM \`Event\` interface and ensures type safety when accessing the element that fired the event.

```ts
Event & {
  currentTarget: HTMLElementTagNameMap[T];
}
```

### Slots

The button component supports slots for additional content placement within the component. Learn more about [using slots](https://shopify.dev/docs/api/polaris/using-polaris-web-components#slots).

* **children**

  **HTMLElement**

  The label text or elements displayed inside the button component, describing the action that will be performed when clicked.

***

## Examples

### Add a basic button

Create a button with a text label to let merchants trigger an action. This example shows the basic button component with default styling.

## html

```html
<s-button>Save</s-button>
```

### Add primary and secondary buttons

Create buttons for actions like saving, creating, or navigating. This example shows primary and secondary buttons with clear, action-oriented labels.

## html

```html
<s-button variant="primary">Add Product</s-button>
<s-button variant="secondary">Save Theme</s-button>
```

***

## Best practices

* **Label buttons clearly:** Use strong, actionable verbs that clearly and accurately describe the action (like **Save**, **Edit**, or **Add tags**). Write labels in sentence case and avoid unnecessary words and articles (like **a**, **an**, **the**). Don't use punctuation.
* **Use appropriate button tones:** Apply established button tones appropriately. Use critical tone only for destructive actions that are difficult or impossible to undo. Match the tone to the action's impact and importance.
* **Establish clear hierarchy:** Prioritize the most important actions to avoid confusion. Use primary buttons for main actions, secondary buttons for supporting actions, and tertiary buttons for supplementary actions.
* **Position consistently:** Place buttons in consistent locations throughout the interface to create predictable interaction patterns.
* **Icon-only buttons:** For icon-only buttons, always use `accessibilityLabel` to describe the action for screen reader users.

***

## Limitations

* When using `href` for navigation, external URLs (domains outside Shopify admin) might be blocked or show security warnings depending on the extension context and merchant's browser security settings.
* Setting `loading={true}` provides visual feedback and prevents form submission or multiple clicks. You must implement additional logic to debounce or disable the button action during async operations.
* Icon-only buttons have a minimum touch target size but don't expand to fill available space. They maintain a fixed size based on the icon and padding, which might create layout inconsistencies if mixed with text buttons in the same container.
* Disabled buttons (`disabled={true}`) are removed from the tab order and can't receive keyboard focus. If you disable a button temporarily (for example, while waiting for form validation), then provide visible text explaining why it's disabled. For async operations, use `loading` over `disabled` because `loading` communicates that an action is in progress.

***
