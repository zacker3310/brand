---
title: Table
description: >-
  The table component displays data clearly in rows and columns, helping users
  view, analyze, and compare structured information. Use table to present
  datasets, product lists, order details, or any tabular content that benefits
  from organized rows and columns.
api_version: v2.0
source_url:
  html: >-
    https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/table
  md: >-
    https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/table.md
api_name: app-home
---

# Table

The table component displays data clearly in rows and columns, helping users view, analyze, and compare structured information. Use table to present datasets, product lists, order details, or any tabular content that benefits from organized rows and columns.

Tables automatically adapt to screen size, rendering as lists on small screens and tables on larger ones for optimal readability across devices.

#### Use cases

* **Data tables:** Display tabular data with headers, rows, and cells.
* **Filterable data:** Add search or filter controls above the table with the `filters` slot.
* **Paginated data:** Show large datasets with pagination controls.
* **Structured data:** Present structured data in accessible table format.

```html
<s-table>
  <s-table-header-row>
    <s-table-header listSlot="primary">Product</s-table-header>
    <s-table-header listSlot="secondary">Status</s-table-header>
  </s-table-header-row>
  <s-table-body>
    <s-table-row>
      <s-table-cell>Everyday tote</s-table-cell>
      <s-table-cell><s-badge tone="success">Active</s-badge></s-table-cell>
    </s-table-row>
    <s-table-row>
      <s-table-cell>Canvas backpack</s-table-cell>
      <s-table-cell><s-badge>Draft</s-badge></s-table-cell>
    </s-table-row>
  </s-table-body>
</s-table>
```

***

## Properties

Configure the following properties on the table component.

* **loading**

  **boolean**

  **Default: false**

  Whether the table is in a loading state, such as during initial page load or when loading the next page in a paginated table. When `true`, the table might be in an inert state that prevents user interaction.

* **variant**

  **"auto" | "list"**

  **Default: 'auto'**

  The layout variant of the table component.

  * `list`: Always displays as a list layout.
  * `auto`: Automatically displays as a table on wide screens and as a list on narrow screens.


### Slots

The table component supports slots for additional content placement within the component. Learn more about [using slots](https://shopify.dev/docs/api/polaris/using-polaris-web-components#slots).

* **children**

  **HTMLElement**

  The table structure defining headers and data rows.

  Accepts table header row (for column headers) and table body (for data rows) components. Structure your table with a table header row first, followed by table body.

* **filters**

  **HTMLElement**

  Filter controls displayed above the table.

  Accepts input components like search field or select for filtering table data. These controls appear in a dedicated area above the table content.

### Events

The table component provides event callbacks for handling user interactions. Learn more about [handling events](https://shopify.dev/docs/api/polaris/using-polaris-web-components#handling-events).

* **nextpage**

  **CallbackEventListener\<typeof tagName> | null**

  A callback fired when the user navigates to the next page.

* **previouspage**

  **CallbackEventListener\<typeof tagName> | null**

  A callback fired when the user navigates to the previous page.

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

***

## Table row

The table row component represents a single row of data within a table body. Use table row as a child of table body to structure individual records or entries in the table.

Table row must contain table cell components, with each cell representing a data value for the corresponding column. The number of cells should match the number of headers in the table.

* **click​Delegate**

  **string**

  The ID of an interactive element, such as `s-link`, in the row that will be the target of the click when the row is clicked. This is the primary action for the row; it should not be used for secondary actions.

  This is a click-only affordance, and does not introduce any keyboard or screen reader affordances. Which is why the target element must be in the table; so that keyboard and screen reader users can interact with it normally.

### Slots

The table row component supports slots for additional content placement within the component. Learn more about [using slots](https://shopify.dev/docs/api/polaris/using-polaris-web-components#slots).

* **children**

  **HTMLElement**

  The data cells displayed in this table row.

  Accepts table cell components, with each cell containing a data value for the corresponding column.

***

## Best practices

* **Use for structured, comparable data:** The component works best when displaying multiple records with consistent attributes that merchants need to scan and compare. For simple lists without comparison needs, consider using a simpler component.
* **Design for mobile transformation:** The component automatically converts to a list layout on mobile devices. Ensure your column headers and data make sense when displayed as stacked key-value pairs rather than a grid.
* **Keep column counts reasonable:** Tables with many columns become difficult to scan and require horizontal scrolling. Aim for the minimum columns needed to support user tasks, and consider whether some data could be revealed on demand.
* **Provide clear column headers:** Column headers help merchants understand what each column represents. Write concise, descriptive headers that clearly identify the data type or attribute.
* **Consider data volume:** Large tables impact performance and user experience. Use pagination for datasets with more than 50-100 rows, or consider whether filtering or search would help merchants find specific records more efficiently.

***

## Limitations

* The component doesn't include built-in sorting or search functionality. You'll need to implement these features yourself if merchants need to organize data within the table. For filtering, use the `filters` slot to add filter UI such as a search field.
* The component doesn't support sticky headers that remain visible during scrolling. If merchants need to reference column headers while viewing data further down the table, consider using pagination to keep datasets smaller.

***
