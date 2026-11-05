# GridList

A grid list displays a list of interactive items, with support for keyboard navigation,
single or multiple selection, and row actions.

## Keyboard navigation

By default, GridList uses arrow key navigation to move focus into rows. Set `keyboardNavigationBehavior="tab"` to have <Keyboard>Tab</Keyboard> move focus in and out of a row.
Use this when rows contain interactive elements such as text fields, where arrow keys and typing in the field should not trigger grid navigation or selection.

```tsx
import {GridList, GridListItem, Text} from 'vanilla-starter/GridList';
import {TextField} from 'vanilla-starter/TextField';

let photos = [
  {id: 1, title: 'Desert Sunset', description: 'PNG • 2/3/2024', src: 'https://images.unsplash.com/photo-1705034598432-1694e203cdf3?q=80&w=600&auto=format&fit=crop'},
  {id: 2, title: 'Hiking Trail', description: 'JPEG • 1/10/2022', src: 'https://images.unsplash.com/photo-1722233987129-61dc344db8b6?q=80&w=600&auto=format&fit=crop'},
  {id: 3, title: 'Lion', description: 'JPEG • 8/28/2021', src: 'https://images.unsplash.com/photo-1629812456605-4a044aa38fbc?q=80&w=600&auto=format&fit=crop'},
  {id: 4, title: 'Mountain Sunrise', description: 'PNG • 3/15/2015', src: 'https://images.unsplash.com/photo-1722172118908-1a97c312ce8c?q=80&w=600&auto=format&fit=crop'},
  {id: 5, title: 'Giraffe tongue', description: 'PNG • 11/27/2019', src: 'https://images.unsplash.com/photo-1574870111867-089730e5a72b?q=80&w=600&auto=format&fit=crop'},
  {id: 6, title: 'Golden Hour', description: 'WEBP • 7/24/2024', src: 'https://images.unsplash.com/photo-1718378037953-ab21bf2cf771?q=80&w=600&auto=format&fit=crop'},
];

<GridList
  /*- begin highlight -*/
  keyboardNavigationBehavior="tab"
  /*- end highlight -*/
  items={photos}
  selectionMode="multiple"
  aria-label="Shared files">
  {item => (
    <GridListItem textValue={item.title}>
      <img src={item.src} alt="" />
      <Text>
        <TextField style={{paddingTop: 2, paddingBottom: 2}} aria-label="title" defaultValue={item.title} placeholder="Enter a title" />
      </Text>
      <Text slot="description">{item.description}</Text>
    </GridListItem>
  )}
</GridList>
```

## API

```tsx
<GridList>
  <GridListItem>
    <Button slot="drag" />
    <Checkbox slot="selection" /> or <SelectionIndicator />
  </GridListItem>
  <GridListLoadMoreItem />
</GridList>
```

### GridList

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `keyboardNavigationBehavior` | `"arrow" | "tab" | undefined` | 'arrow' | Whether keyboard navigation to focusable elements within grid list items is via the left/right arrow keys or the tab key. |
| `onMouseDown` | `React.MouseEventHandler<HTMLDivElement> | undefined` | — |  |
| `selectionMode` | `SelectionMode | undefined` | — | The type of selection that is allowed in the collection. |

