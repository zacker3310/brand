/**
 * ATLAS canonical taxonomy. ATLAS-authored. Used for classification, search synonyms,
 * catalog navigation and cross-system comparison.
 *
 * `aliases` are names that map to this type with high confidence (e.g. "Dropdown" -> select is NOT
 * an alias, because "dropdown" is ambiguous across systems; it is a nearSynonym of select, menu
 * and combobox). Classification by alias is still marked `inferred` unless the adapter's source
 * explicitly identifies the pattern.
 */

export interface ComponentGroup {
  slug: string;
  name: string;
  description: string;
}

export interface ComponentTypeDef {
  slug: string;
  name: string;
  group: string;
  description: string;
  aliases: string[];
  nearSynonyms: string[];
  ariaPattern?: string; // WAI-ARIA Authoring Practices pattern slug
}

export const COMPONENT_GROUPS: ComponentGroup[] = [
  { slug: "actions", name: "Actions", description: "Controls that trigger an operation or navigation." },
  { slug: "inputs", name: "Inputs", description: "Controls that capture user-entered values." },
  { slug: "navigation", name: "Navigation", description: "Wayfinding between views, sections and steps." },
  { slug: "data-display", name: "Data display", description: "Presenting records, collections and status." },
  { slug: "feedback", name: "Feedback", description: "Communicating system status, progress and outcomes." },
  { slug: "overlays", name: "Overlays", description: "Content layered above the page, transient or modal." },
  { slug: "layout", name: "Layout", description: "Structural primitives for arranging content." },
  { slug: "content", name: "Content", description: "Typography, media and rich content rendering." },
  { slug: "visualization", name: "Visualization", description: "Charts and graphical data encodings." },
  { slug: "complex-patterns", name: "Complex patterns", description: "Multi-component compositions solving a product task." },
];

const t = (
  slug: string,
  name: string,
  group: string,
  description: string,
  aliases: string[] = [],
  nearSynonyms: string[] = [],
  ariaPattern?: string,
): ComponentTypeDef => ({ slug, name, group, description, aliases, nearSynonyms, ariaPattern });

export const COMPONENT_TYPES: ComponentTypeDef[] = [
  // Actions
  t("button", "Button", "actions", "Triggers an action or event when activated.", ["button", "btn", "action button", "push button", "base button"], ["link button"], "button"),
  t("icon-button", "Icon button", "actions", "A button whose label is conveyed by an icon, requiring an accessible name.", ["icon button", "iconbutton", "button icon", "action icon", "icon only button"], ["button"], "button"),
  t("split-button", "Split button", "actions", "A primary action combined with a menu of related actions.", ["split button", "splitbutton", "combo button", "button split"], ["menu button"], "menu-button"),
  t("floating-action-button", "Floating action button", "actions", "A prominent button for the primary action on a screen, floating above content.", ["fab", "floating action button", "extended fab", "speed dial"], ["button"]),
  t("link", "Link", "actions", "Navigates to another location or resource.", ["link", "hyperlink", "text link", "inline link"], ["button"], "link"),
  t("menu-button", "Menu button", "actions", "A button that opens a menu of actions.", ["menu button", "menubutton", "action menu", "dropdown button", "overflow menu", "kebab menu"], ["dropdown", "split button"], "menu-button"),
  t("button-group", "Button group", "actions", "A set of related buttons presented together.", ["button group", "buttongroup", "button set", "segmented button"], ["toggle group", "segmented control"]),
  t("toggle-button", "Toggle button", "actions", "A two-state button that can be pressed or unpressed.", ["toggle button", "togglebutton"], ["switch", "segmented control", "toggle"], "button"),

  // Inputs
  t("text-field", "Text field", "inputs", "Single-line free-text input.", ["text field", "textfield", "text input", "input", "textinput", "input field", "text box", "textbox"], ["search field"]),
  t("textarea", "Textarea", "inputs", "Multi-line free-text input.", ["textarea", "text area", "multiline text field", "multiline input"], ["rich text editor"]),
  t("number-field", "Number field", "inputs", "Numeric input, often with increment and decrement controls.", ["number field", "number input", "numberinput", "numeric input", "stepper input", "spin button", "spinbutton", "input number"], [], "spinbutton"),
  t("search-field", "Search field", "inputs", "A text input specialized for entering search queries.", ["search field", "search input", "searchbar", "search bar", "search box", "searchbox"], ["text field", "combobox", "command palette"]),
  t("password-field", "Password field", "inputs", "Text input for secrets with masked entry.", ["password field", "password input", "passwordinput"], ["text field"]),
  t("checkbox", "Checkbox", "inputs", "Toggles a single option on or off, or selects multiple options from a set.", ["checkbox", "check box", "checkbox group"], ["switch"], "checkbox"),
  t("radio", "Radio", "inputs", "Selects exactly one option from a set.", ["radio", "radio button", "radio group", "radiogroup", "radiobutton"], ["segmented control"], "radio"),
  t("switch", "Switch", "inputs", "Toggles a setting on or off with immediate effect.", ["switch", "toggle switch"], ["checkbox", "toggle button", "toggle"], "switch"),
  t("slider", "Slider", "inputs", "Selects a value or range by moving a thumb along a track.", ["slider", "range slider", "range", "range input"], [], "slider"),
  t("select", "Select", "inputs", "Chooses one value from a collapsed list of options.", ["select", "native select", "select field", "picker", "selectfield"], ["dropdown", "combobox", "listbox"], "listbox"),
  t("combobox", "Combobox", "inputs", "A text input combined with a popup list of suggested values.", ["combobox", "combo box", "autocomplete input", "typeahead", "filterable select", "searchable select"], ["autocomplete", "select", "dropdown", "search field"], "combobox"),
  t("autocomplete", "Autocomplete", "inputs", "Suggests completions as the user types into a field.", ["autocomplete", "auto complete", "autosuggest", "auto suggest"], ["combobox", "typeahead"], "combobox"),
  t("multi-select", "Multi-select", "inputs", "Selects multiple values from a list, often rendered as chips.", ["multiselect", "multi select", "multi-select", "tag input", "tags input", "tag picker"], ["combobox", "chip"]),
  t("date-picker", "Date picker", "inputs", "Selects a date or date range, typically via a calendar.", ["date picker", "datepicker", "date input", "date field", "date range picker", "calendar picker"], ["calendar"], "dialog-modal"),
  t("calendar", "Calendar", "inputs", "A month grid for selecting or displaying dates.", ["calendar", "range calendar"], ["date picker"], "grid"),
  t("time-picker", "Time picker", "inputs", "Selects a time of day.", ["time picker", "timepicker", "time input", "time field"], []),
  t("file-upload", "File upload", "inputs", "Selects files from the device, often with drag-and-drop.", ["file upload", "file uploader", "fileuploader", "file input", "dropzone", "drop zone", "upload", "file picker", "file trigger"], []),
  t("color-picker", "Color picker", "inputs", "Selects a color value.", ["color picker", "colorpicker", "color input", "color field", "color area", "color wheel", "color swatch picker"], []),
  t("rating", "Rating", "inputs", "Captures or displays a score, typically as stars.", ["rating", "star rating", "rate"], []),
  t("segmented-control", "Segmented control", "inputs", "A set of mutually exclusive options presented as joined segments.", ["segmented control", "segmentedcontrol", "segmented", "segmented button", "content switcher", "toggle group", "button toggle"], ["tabs", "radio", "button group"], "radio"),
  t("form-field", "Form field", "inputs", "Wrapper providing label, help text and validation for a control.", ["form field", "formfield", "form control", "formcontrol", "field", "form group", "form item"], ["label"]),
  t("label", "Label", "inputs", "Text that names a form control.", ["label", "form label", "field label"], ["form field"]),
  t("pin-input", "PIN input", "inputs", "Segmented entry for short codes such as one-time passwords.", ["pin input", "pininput", "otp input", "otp field", "one time password", "verification code input", "code input"], []),

  // Navigation
  t("tabs", "Tabs", "navigation", "Switches between related panels of content within the same context.", ["tabs", "tab", "tab bar", "tabbar", "tab nav", "underline nav", "tab list", "tabset"], ["segmented control", "navigation bar"], "tabs"),
  t("breadcrumbs", "Breadcrumbs", "navigation", "Shows the current location within a hierarchy with links to ancestors.", ["breadcrumbs", "breadcrumb", "bread crumbs"], [], "breadcrumb"),
  t("pagination", "Pagination", "navigation", "Navigates between pages of a large result set.", ["pagination", "pager", "paginator", "page navigation"], []),
  t("navigation-rail", "Navigation rail", "navigation", "A compact vertical bar of primary destinations.", ["navigation rail", "nav rail", "rail"], ["sidebar", "navigation drawer"]),
  t("sidebar", "Sidebar", "navigation", "A persistent vertical region for navigation or secondary content.", ["sidebar", "side nav", "sidenav", "side navigation", "nav list", "navlist", "vertical navigation", "side bar"], ["navigation drawer", "navigation rail"]),
  t("navigation-drawer", "Navigation drawer", "navigation", "A panel of destinations that slides in from the edge of the screen.", ["navigation drawer", "nav drawer"], ["drawer", "sidebar"]),
  t("navigation-bar", "Navigation bar", "navigation", "A bar of top-level destinations, at the top or bottom of the screen.", ["navigation bar", "navbar", "nav bar", "bottom navigation", "bottom nav", "app bar", "top app bar", "header", "masthead", "global header", "ui shell", "top navigation", "bottom app bar"], ["tabs", "toolbar"]),
  t("menu", "Menu", "navigation", "A list of actions or options presented in a popup.", ["menu", "action list", "actionlist", "dropdown menu", "menu list", "menubar", "popup menu"], ["dropdown", "context menu", "select"], "menubar"),
  t("command-palette", "Command palette", "navigation", "A searchable launcher for commands and destinations.", ["command palette", "command menu", "command bar", "cmdk", "spotlight", "quick open"], ["search field", "combobox"], "combobox"),
  t("stepper", "Stepper", "navigation", "Shows progress through a sequence of steps.", ["stepper", "steps", "step indicator", "progress indicator steps", "wizard", "progress tracker", "progress stepper"], ["progress indicator"]),
  t("page-header", "Page header", "navigation", "The title area of a page or view, with context, metadata and primary actions.", ["page header", "pageheader", "page title", "title bar", "page heading"], ["navigation bar", "breadcrumbs"]),
  t("toolbar", "Toolbar", "navigation", "A container grouping a set of controls.", ["toolbar", "tool bar", "action bar", "actionbar"], ["navigation bar", "button group"], "toolbar"),
  t("skip-link", "Skip link", "navigation", "Lets keyboard users bypass repeated content.", ["skip link", "skiplink", "skip to content", "skip navigation"], ["link"]),
  t("anchor-navigation", "Anchor navigation", "navigation", "In-page links to sections of the current page.", ["anchor navigation", "table of contents", "in page navigation", "on this page", "jump links", "anchor"], ["sidebar"]),

  // Data display
  t("table", "Table", "data-display", "Presents structured data in rows and columns.", ["table", "data table", "datatable", "simple table", "table view"], ["data grid"], "table"),
  t("data-grid", "Data grid", "data-display", "An interactive grid with cell navigation, editing, sorting or virtualization.", ["data grid", "datagrid", "grid table", "editable table", "spreadsheet"], ["table"], "grid"),
  t("list", "List", "data-display", "Presents a series of related items.", ["list", "list view", "listview", "list item", "item list", "description list", "structured list"], ["listbox", "table"]),
  t("listbox", "Listbox", "data-display", "A list of selectable options.", ["listbox", "list box", "selectable list", "option list"], ["select", "list"], "listbox"),
  t("tree", "Tree", "data-display", "Hierarchical list with expandable nodes.", ["tree", "tree view", "treeview", "tree list"], [], "treeview"),
  t("card", "Card", "data-display", "A container grouping content and actions about a single subject.", ["card", "tile", "panel card", "media card"], ["box", "container"]),
  t("badge", "Badge", "data-display", "A small indicator of count or status attached to another element.", ["badge", "counter", "count badge", "notification badge", "indicator", "counter label"], ["tag", "status"]),
  t("tag", "Tag", "data-display", "A compact label for categorization or filtering, sometimes removable.", ["tag", "chip", "pill", "token", "label tag", "lozenge", "issue label", "interaction tag"], ["badge"]),
  t("avatar", "Avatar", "data-display", "Represents a person or entity with an image, initials or icon.", ["avatar", "user avatar", "profile picture", "avatar group", "avatar stack", "persona"], []),
  t("tooltip", "Tooltip", "data-display", "A brief label shown on hover or focus to describe an element.", ["tooltip", "tool tip", "info tip"], ["popover", "toggletip"], "tooltip"),
  t("toggletip", "Toggletip", "data-display", "A disclosure of supplemental info triggered by click, not hover.", ["toggletip", "toggle tip", "info button"], ["tooltip", "popover"]),
  t("accordion", "Accordion", "data-display", "Vertically stacked headers that expand to reveal content.", ["accordion", "expansion panel", "collapsible", "disclosure", "details", "expander"], ["collapse"], "accordion"),
  t("timeline", "Timeline", "data-display", "Presents events in chronological order.", ["timeline", "activity feed", "time line"], []),
  t("statistic", "Statistic", "data-display", "Highlights a key metric value with label.", ["statistic", "stat", "metric", "kpi", "big number", "key value"], []),
  t("description-list", "Description list", "data-display", "Pairs of terms and descriptions, such as record details.", ["description list", "descriptions", "key value list", "definition list", "summary list", "data list", "property list"], ["list"]),
  t("status-indicator", "Status indicator", "data-display", "Communicates the state of an object with color, icon and text.", ["status indicator", "status", "status light", "status dot", "state label", "status label"], ["badge", "tag"]),
  t("carousel", "Carousel", "data-display", "Cycles through a set of slides.", ["carousel", "slider gallery", "slideshow"], [], "carousel"),
  t("kbd", "Keyboard key", "data-display", "Displays a keyboard key or shortcut.", ["kbd", "keyboard", "keyboard shortcut", "keyboard key", "hotkey"], []),

  // Feedback
  t("alert", "Alert", "feedback", "An inline message communicating important status.", ["alert", "banner", "callout", "inline notification", "inline alert", "message bar", "messagebar", "notice", "flash", "section message", "inline message", "admonition"], ["toast", "notification"], "alert"),
  t("toast", "Toast", "feedback", "A brief, temporary message about a process, shown away from the main content.", ["toast", "snackbar", "toast notification", "toaster"], ["notification", "alert"], "alert"),
  t("notification", "Notification", "feedback", "A message about an event, often persistent and in a notification surface.", ["notification", "notifications", "notification center", "flag"], ["toast", "alert"]),
  t("progress-indicator", "Progress indicator", "feedback", "Shows determinate or indeterminate progress of a task.", ["progress indicator", "progress bar", "progressbar", "progress", "linear progress", "meter", "progress circle", "circular progress", "progress ring"], ["spinner", "stepper"], "meter"),
  t("spinner", "Spinner", "feedback", "An indeterminate indicator that something is loading.", ["spinner", "spin", "loader", "loading", "loading indicator", "activity indicator", "busy indicator", "inline loading"], ["progress indicator", "skeleton"]),
  t("skeleton", "Skeleton", "feedback", "A placeholder preview of content while it loads.", ["skeleton", "skeleton loader", "placeholder", "shimmer", "skeleton text"], ["spinner"]),
  t("empty-state", "Empty state", "feedback", "Content shown when there is no data to display.", ["empty state", "emptystate", "blank slate", "blankslate", "zero state", "no results", "empty", "empty content"], []),
  t("live-region", "Live region", "feedback", "Announces dynamic content changes to assistive technology without moving focus.", ["live region", "aria live", "aria status", "aria alert", "announcer", "status announcer", "visually hidden announcement"], ["alert", "toast"], "alert"),
  t("validation-message", "Validation message", "feedback", "Communicates errors or guidance for a form field.", ["validation message", "error message", "field error", "inline validation", "helper text", "form validation", "error summary", "validation"], ["alert"]),

  // Overlays
  t("dialog", "Dialog", "overlays", "A window overlaid on the page that requires interaction.", ["dialog", "modal dialog", "alert dialog", "confirm dialog", "dialogue", "confirmation dialog"], ["modal", "sheet"], "dialog-modal"),
  t("modal", "Modal", "overlays", "A blocking overlay that disables the content beneath it.", ["modal", "modal window", "lightbox"], ["dialog", "sheet"], "dialog-modal"),
  t("sheet", "Sheet", "overlays", "A surface that slides in from an edge of the screen.", ["sheet", "bottom sheet", "side sheet", "drawer", "side panel", "flyout", "off canvas", "offcanvas", "slide over", "tearsheet"], ["dialog", "navigation drawer", "panel"], "dialog-modal"),
  t("popover", "Popover", "overlays", "Non-modal floating content anchored to a trigger.", ["popover", "pop over", "overlay", "flyout panel", "callout bubble"], ["tooltip", "dropdown", "toggletip", "popup"], "dialog-modal"),
  t("dropdown", "Dropdown", "overlays", "A generic floating list or panel revealed from a trigger.", ["dropdown"], ["menu", "select", "combobox", "popover"]),
  t("context-menu", "Context menu", "overlays", "A menu revealed by right-click or long press.", ["context menu", "contextmenu", "right click menu"], ["menu"], "menubar"),
  t("hover-card", "Hover card", "overlays", "Rich preview content shown when hovering a link or element.", ["hover card", "hovercard", "preview card"], ["popover", "tooltip"]),

  // Layout
  t("container", "Container", "layout", "Constrains content width and provides consistent padding.", ["container", "page container", "content container", "wrapper", "page layout", "page", "section"], ["box"]),
  t("box", "Box", "layout", "A generic styled primitive for composing layout.", ["box", "view", "surface", "paper", "sheet surface", "well"], ["container", "card", "panel"]),
  t("stack", "Stack", "layout", "Arranges children in one direction with consistent spacing.", ["stack", "vstack", "hstack", "inline", "space", "spacer stack", "layout stack", "column", "columns", "inline stack", "block stack"], ["flex"]),
  t("grid", "Grid", "layout", "A two-dimensional layout primitive based on columns and rows.", ["grid", "layout grid", "simple grid", "css grid", "row", "col", "grid layout"], ["data grid"]),
  t("flex", "Flex", "layout", "A flexible box layout primitive.", ["flex", "flexbox", "flex layout"], ["stack"]),
  t("divider", "Divider", "layout", "A thin rule separating content.", ["divider", "separator", "rule", "hr", "horizontal rule"], []),
  t("spacer", "Spacer", "layout", "An empty element that consumes space.", ["spacer", "space"], ["stack"]),
  t("resizable-panel", "Resizable panel", "layout", "Panels whose size users can adjust with a handle.", ["resizable", "resizable panel", "resizable panels", "splitter", "split pane"], ["split view"], "windowsplitter"),
  t("split-view", "Split view", "layout", "Two or more side-by-side panes, such as list and detail.", ["split view", "splitview", "split page layout", "two column layout", "master detail"], ["resizable panel"]),
  t("aspect-ratio", "Aspect ratio", "layout", "Maintains a fixed width-to-height ratio for content.", ["aspect ratio", "aspectratio", "ratio"], []),
  t("scroll-area", "Scroll area", "layout", "A region with custom, accessible scrolling.", ["scroll area", "scrollarea", "scroll container", "scroll view"], []),

  // Content
  t("typography", "Typography", "content", "Components for headings, body copy and text styles.", ["typography", "text", "heading", "title", "paragraph", "body text", "type"], []),
  t("icon", "Icon", "content", "A symbolic graphic, often from an icon set.", ["icon", "icons", "iconography", "svg icon", "symbol", "pictogram"], []),
  t("image", "Image", "content", "Displays an image with loading and fallback behavior.", ["image", "img", "picture", "media", "thumbnail"], ["avatar"]),
  t("video", "Video", "content", "Embeds a video player.", ["video", "video player", "media player"], []),
  t("code-block", "Code block", "content", "Displays formatted source code.", ["code block", "codeblock", "code snippet", "code", "snippet", "syntax highlighter", "inline code"], []),
  t("markdown", "Markdown", "content", "Renders Markdown-authored content.", ["markdown", "markdown viewer", "prose", "rendered markdown"], ["rich text"]),
  t("rich-text-editor", "Rich text editor", "content", "Edits formatted text.", ["rich text editor", "rich text", "wysiwyg", "text editor", "editor"], ["textarea", "markdown"]),
  t("blockquote", "Blockquote", "content", "Displays a quotation.", ["blockquote", "quote", "pull quote"], []),

  // Visualization
  t("chart", "Chart", "visualization", "Encodes data visually, such as bar, line or pie charts.", ["chart", "charts", "bar chart", "line chart", "pie chart", "area chart", "donut chart", "data visualization", "data viz", "dataviz"], ["graph"]),
  t("graph", "Graph", "visualization", "Visualizes nodes and edges or network relationships.", ["graph", "network graph", "node graph", "flow diagram", "diagram"], ["chart"]),
  t("map", "Map", "visualization", "Displays geographic data.", ["map", "geo map", "choropleth"], []),
  t("gauge", "Gauge", "visualization", "Displays a value within a range on a dial.", ["gauge", "dial", "radial gauge", "speedometer"], ["progress indicator"], "meter"),
  t("heatmap", "Heatmap", "visualization", "Encodes values as color in a matrix.", ["heatmap", "heat map"], ["chart"]),
  t("sparkline", "Sparkline", "visualization", "A small, word-sized trend chart.", ["sparkline", "spark line", "micro chart"], ["chart"]),

  // Complex patterns implemented as components
  t("search", "Search", "complex-patterns", "A composed search experience with input, suggestions and results.", ["global search", "site search"], ["search field", "command palette"]),
  t("filter", "Filter", "complex-patterns", "Controls for narrowing a collection by criteria.", ["filter", "filters", "filter bar", "faceted search", "filter panel", "property filter"], ["search"]),
  t("authentication", "Authentication", "complex-patterns", "Sign-in, sign-up and identity verification flows.", ["login", "sign in", "sign-in", "authentication", "login form", "signin"], []),
  t("onboarding", "Onboarding", "complex-patterns", "Introduces new users to a product or feature.", ["onboarding", "coachmark", "coach mark", "product tour", "tour", "walkthrough", "guided tour", "spotlight tour"], []),
  t("checkout", "Checkout", "complex-patterns", "Purchase flow including cart, payment and confirmation.", ["checkout", "payment form", "cart"], []),
  t("dashboard", "Dashboard", "complex-patterns", "An at-a-glance overview composed of metrics and widgets.", ["dashboard", "dashboards"], []),
  t("form", "Form", "complex-patterns", "A composed set of fields for submitting data.", ["form", "forms", "form layout", "fieldset"], ["form field"]),
  t("settings", "Settings", "complex-patterns", "Configuration surfaces for preferences.", ["settings", "preferences", "settings page"], []),
  t("bulk-actions", "Bulk actions", "complex-patterns", "Applying an action to multiple selected items.", ["bulk actions", "batch actions", "bulk action bar", "selection toolbar"], []),
];

export interface PatternTypeDef {
  slug: string;
  name: string;
  description: string;
  aliases: string[];
}

export const PATTERN_TYPES: PatternTypeDef[] = [
  { slug: "authentication", name: "Authentication", description: "Signing in, signing up, password recovery and identity verification.", aliases: ["sign in", "login", "sign-in", "create an account", "passwords", "authentication"] },
  { slug: "navigation", name: "Navigation", description: "Structuring and moving between the destinations of a product.", aliases: ["navigation", "wayfinding", "menus", "information architecture"] },
  { slug: "search", name: "Search", description: "Helping users find content via queries, suggestions and results.", aliases: ["search", "find", "search results"] },
  { slug: "filtering", name: "Filtering", description: "Narrowing a collection by criteria, facets or tokens.", aliases: ["filter", "filtering", "facets", "sorting"] },
  { slug: "data-tables", name: "Data tables", description: "Displaying, sorting, selecting and acting on tabular data.", aliases: ["data table", "tables", "data display"] },
  { slug: "data-visualization", name: "Data visualization", description: "Guidance for charts, graphs and visual encodings of data.", aliases: ["data visualization", "data viz", "dataviz", "charts", "charting"] },
  { slug: "forms", name: "Forms", description: "Collecting, validating and submitting user input.", aliases: ["forms", "form", "question pages", "form design", "input", "inputs"] },
  { slug: "empty-states", name: "Empty states", description: "What to show when there is no content yet or no results.", aliases: ["empty state", "empty states", "zero state", "blank slate", "no results"] },
  { slug: "error-recovery", name: "Error recovery", description: "Preventing, communicating and recovering from errors.", aliases: ["errors", "error messages", "validation", "error handling", "problem pages", "error page"] },
  { slug: "loading", name: "Loading", description: "Communicating progress and perceived performance.", aliases: ["loading", "progress", "skeletons", "wait"] },
  { slug: "notifications", name: "Notifications", description: "Communicating events and system status to users.", aliases: ["notifications", "messaging", "feedback", "alerts", "notification"] },
  { slug: "settings", name: "Settings", description: "Organizing preferences and configuration.", aliases: ["settings", "preferences", "configuration"] },
  { slug: "onboarding", name: "Onboarding", description: "Introducing new users and features.", aliases: ["onboarding", "first run", "welcome", "user onboarding"] },
  { slug: "checkout", name: "Checkout", description: "Purchase and payment flows.", aliases: ["checkout", "payment", "pay", "payments"] },
  { slug: "dashboards", name: "Dashboards", description: "Overviews composed of metrics, charts and summaries.", aliases: ["dashboard", "dashboards", "overview"] },
  { slug: "bulk-actions", name: "Bulk actions", description: "Selecting many items and acting on them at once.", aliases: ["bulk actions", "batch", "selection"] },
  { slug: "dialogs-and-confirmation", name: "Dialogs & confirmation", description: "Interrupting a flow to confirm, warn or collect focused input.", aliases: ["confirmation", "destructive actions", "confirm", "modals"] },
  { slug: "content-and-writing", name: "Content & writing", description: "Voice, tone, and writing guidance for interface copy.", aliases: ["content", "writing", "voice and tone", "content design", "ux writing", "grammar"] },
  { slug: "accessibility", name: "Accessibility", description: "System-level guidance for inclusive design.", aliases: ["accessibility", "a11y", "inclusive design"] },
  { slug: "data-entry", name: "Data entry", description: "Patterns for entering specific kinds of data: dates, addresses, names, numbers.", aliases: ["dates", "addresses", "names", "phone numbers", "email addresses", "bank details", "national insurance numbers"] },
  { slug: "help-and-guidance", name: "Help & guidance", description: "Contextual help, documentation and assistance.", aliases: ["help", "guidance", "contact", "support", "contextual help"] },
  { slug: "layout-and-structure", name: "Layout & structure", description: "Page templates, page structure and responsive layout.", aliases: ["layout", "page template", "page templates", "structure", "page layout"] },
  { slug: "selection", name: "Selection", description: "Choosing one or many items from a set.", aliases: ["selection", "select", "choose", "multi-select"] },
];

/** Canonical interactive states for normalizing documented component states. */
export const CANONICAL_STATES: Record<string, string[]> = {
  default: ["default", "rest", "enabled", "normal", "idle", "resting"],
  hover: ["hover", "hovered", "mouseover"],
  focus: ["focus", "focused", "focus-visible", "keyboard focus"],
  active: ["active", "pressed", "press", "down"],
  disabled: ["disabled", "unavailable"],
  loading: ["loading", "busy", "pending", "in progress"],
  selected: ["selected", "checked", "on", "current"],
  indeterminate: ["indeterminate", "mixed", "partially checked"],
  error: ["error", "invalid", "danger", "critical", "negative"],
  warning: ["warning", "caution"],
  success: ["success", "valid", "positive"],
  readonly: ["readonly", "read-only", "read only"],
  expanded: ["expanded", "open", "opened"],
  collapsed: ["collapsed", "closed"],
  dragged: ["dragged", "dragging"],
  skeleton: ["skeleton"],
  inactive: ["inactive"],
};

/**
 * Search synonyms. Expansion only, never collapsing: a query for "dropdown" expands to the
 * candidate canonical types, and results keep their system-specific names so users can see
 * they are not interchangeable.
 */
export const SEARCH_SYNONYMS: Record<string, string[]> = {
  dropdown: ["select", "menu", "combobox", "menu-button"],
  toast: ["snackbar", "notification"],
  snackbar: ["toast"],
  notification: ["toast", "alert", "banner"],
  modal: ["dialog", "sheet"],
  dialog: ["modal"],
  popup: ["popover", "dialog", "menu"],
  chip: ["tag", "pill", "badge"],
  pill: ["tag", "chip", "badge"],
  tag: ["chip", "pill"],
  toggle: ["switch", "toggle-button", "checkbox"],
  autocomplete: ["combobox", "typeahead"],
  typeahead: ["combobox", "autocomplete"],
  datepicker: ["date-picker", "calendar"],
  "date picker": ["date-picker", "calendar"],
  drawer: ["sheet", "navigation-drawer"],
  sidebar: ["navigation-drawer", "navigation-rail", "side nav"],
  loader: ["spinner", "progress-indicator", "skeleton"],
  banner: ["alert", "callout"],
  callout: ["alert", "banner"],
  grid: ["data-grid", "table", "layout grid"],
  "data table": ["table", "data-grid"],
  datagrid: ["data-grid", "table"],
  textbox: ["text-field", "input"],
  input: ["text-field", "textarea"],
  tooltip: ["toggletip", "popover"],
  stepper: ["steps", "wizard", "progress-tracker"],
  wizard: ["stepper", "steps"],
  accordion: ["disclosure", "collapsible", "expansion panel"],
  collapsible: ["accordion", "disclosure"],
  breadcrumb: ["breadcrumbs"],
  pager: ["pagination"],
  "dark mode": ["dark", "theme", "color scheme"],
  government: ["gov", "public sector"],
  enterprise: ["business", "b2b", "admin"],
  accessible: ["accessibility", "a11y", "aria", "keyboard"],
  a11y: ["accessibility", "accessible"],
};

/** Framework words recognized in queries ("React combobox" -> framework filter react). */
export const FRAMEWORK_QUERY_WORDS: Record<string, string> = {
  react: "react",
  vue: "vue",
  angular: "angular",
  svelte: "svelte",
  "web components": "web-components",
  "web-components": "web-components",
  webcomponents: "web-components",
  lit: "web-components",
  flutter: "flutter",
  swiftui: "swiftui",
  uikit: "uikit",
  "jetpack compose": "jetpack-compose",
  compose: "jetpack-compose",
  solid: "solid",
  jquery: "jquery",
  blazor: "blazor",
  "react native": "react-native",
  ember: "ember",
  preact: "preact",
  qwik: "qwik",
  html: "html-css",
  rails: "rails",
  viewcomponent: "rails",
  css: "html-css",
};

export const FRAMEWORKS: { slug: string; name: string; kind: string; websiteUrl: string | null }[] = [
  { slug: "react", name: "React", kind: "web", websiteUrl: "https://react.dev" },
  { slug: "vue", name: "Vue", kind: "web", websiteUrl: "https://vuejs.org" },
  { slug: "angular", name: "Angular", kind: "web", websiteUrl: "https://angular.dev" },
  { slug: "svelte", name: "Svelte", kind: "web", websiteUrl: "https://svelte.dev" },
  { slug: "solid", name: "Solid", kind: "web", websiteUrl: "https://www.solidjs.com" },
  { slug: "web-components", name: "Web Components", kind: "web", websiteUrl: "https://developer.mozilla.org/en-US/docs/Web/API/Web_components" },
  { slug: "html-css", name: "HTML/CSS", kind: "css", websiteUrl: null },
  { slug: "jquery", name: "jQuery", kind: "web", websiteUrl: "https://jquery.com" },
  { slug: "ember", name: "Ember", kind: "web", websiteUrl: "https://emberjs.com" },
  { slug: "preact", name: "Preact", kind: "web", websiteUrl: "https://preactjs.com" },
  { slug: "qwik", name: "Qwik", kind: "web", websiteUrl: "https://qwik.dev" },
  { slug: "blazor", name: "Blazor", kind: "web", websiteUrl: "https://dotnet.microsoft.com/apps/aspnet/web-apps/blazor" },
  { slug: "react-native", name: "React Native", kind: "mobile", websiteUrl: "https://reactnative.dev" },
  { slug: "flutter", name: "Flutter", kind: "mobile", websiteUrl: "https://flutter.dev" },
  { slug: "swiftui", name: "SwiftUI", kind: "native", websiteUrl: "https://developer.apple.com/xcode/swiftui/" },
  { slug: "uikit", name: "UIKit", kind: "native", websiteUrl: "https://developer.apple.com/documentation/uikit" },
  { slug: "appkit", name: "AppKit", kind: "native", websiteUrl: "https://developer.apple.com/documentation/appkit" },
  { slug: "jetpack-compose", name: "Jetpack Compose", kind: "native", websiteUrl: "https://developer.android.com/compose" },
  { slug: "android-views", name: "Android Views", kind: "native", websiteUrl: "https://developer.android.com/develop/ui/views" },
  { slug: "winui", name: "WinUI", kind: "native", websiteUrl: "https://learn.microsoft.com/windows/apps/winui/" },
  { slug: "rails", name: "Ruby on Rails (ViewComponent)", kind: "web", websiteUrl: "https://rubyonrails.org" },
  { slug: "nunjucks", name: "Nunjucks", kind: "web", websiteUrl: "https://mozilla.github.io/nunjucks/" },
  { slug: "asp-net", name: "ASP.NET", kind: "web", websiteUrl: "https://dotnet.microsoft.com/apps/aspnet" },
  { slug: "dotnet-maui", name: ".NET MAUI", kind: "mobile", websiteUrl: "https://dotnet.microsoft.com/apps/maui" },
  { slug: "figma", name: "Figma", kind: "design", websiteUrl: "https://www.figma.com" },
];

export const PLATFORMS: { slug: string; name: string }[] = [
  { slug: "web", name: "Web" },
  { slug: "ios", name: "iOS" },
  { slug: "ipados", name: "iPadOS" },
  { slug: "android", name: "Android" },
  { slug: "macos", name: "macOS" },
  { slug: "windows", name: "Windows" },
  { slug: "linux", name: "Linux" },
  { slug: "watchos", name: "watchOS" },
  { slug: "tvos", name: "tvOS" },
  { slug: "visionos", name: "visionOS" },
  { slug: "desktop", name: "Desktop (cross-platform)" },
  { slug: "mobile-web", name: "Mobile web" },
];

/* -------------------------------------------------------------------------- */
/* Classification helpers                                                      */
/* -------------------------------------------------------------------------- */

const normalizeName = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const ALIAS_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const ct of COMPONENT_TYPES) {
    m.set(normalizeName(ct.slug), ct.slug);
    m.set(normalizeName(ct.name), ct.slug);
    for (const a of ct.aliases) {
      const k = normalizeName(a);
      if (!m.has(k)) m.set(k, ct.slug);
    }
  }
  return m;
})();

/** Head nouns too generic to classify by containment ("Exit this page", "Inset text", "Hero section"). */
const GENERIC_HEADS = new Set(["page", "text", "section", "view", "panel", "box", "item", "items", "content", "area", "block", "group", "wrapper", "layout", "type", "title", "header", "footer"]);

export interface Classification {
  slug: string;
  method: string;
  confidence: number;
}

/**
 * Heuristic classification of a system-specific component name into the canonical taxonomy.
 * Always returns an *inferred* classification; adapters may upgrade to verified when the source
 * explicitly declares the pattern.
 */
export function classifyComponentName(name: string): Classification | null {
  const n = normalizeName(name);
  if (!n) return null;
  const exact = ALIAS_INDEX.get(n);
  if (exact) return { slug: exact, method: `alias-exact:${n}`, confidence: 0.9 };
  // strip common prefixes/suffixes used by libraries: "Base", "Md", "Cds", "Sl", "UI", "Component", "Group"
  const stripped = n
    .replace(/^(base|md|mwc|cds|sl|ui|ion|q|v|el|n|p|k|igx|dx|e|ej|mat|fluent|spectrum|sp|bx|hds|wa|calcite|fds|nds|duet|nord)\s+/, "")
    .replace(/\s+(component|element|group|root|container|wrapper|field)$/, "")
    .trim();
  const s = ALIAS_INDEX.get(stripped);
  if (s) return { slug: s, method: `alias-stripped:${stripped}`, confidence: 0.75 };
  // plural page titles ("Buttons", "Icon buttons", "Date pickers") -> singular alias
  const singular = (w: string) => w.replace(/(ches|shes|xes)$/, (m) => m.slice(0, -2)).replace(/ies$/, "y").replace(/(?<!s)s$/, "");
  for (const cand of [n, stripped]) {
    const words = cand.split(" ");
    const sg = [...words.slice(0, -1), singular(words[words.length - 1] ?? "")].join(" ");
    if (sg !== cand) {
      const hit = ALIAS_INDEX.get(sg);
      if (hit) return { slug: hit, method: `alias-singular:${sg}`, confidence: 0.85 };
    }
  }
  // token containment (longest alias contained in name), e.g. "Overflow Menu" -> menu-button via alias
  // Containment only in head-noun position (the alias ends the name): "Inline error" is not a stack,
  // "Page actions" is not a container, but "Overflow menu" is a menu.
  let best: { slug: string; alias: string } | null = null;
  for (const [alias, slug] of ALIAS_INDEX) {
    if (alias.length < 4 || GENERIC_HEADS.has(alias)) continue;
    const re = new RegExp(`(^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    if (re.test(n) && (!best || alias.length > best.alias.length)) best = { slug, alias };
  }
  if (best) return { slug: best.slug, method: `alias-contained:${best.alias}`, confidence: 0.55 };
  return null;
}

export function canonicalState(name: string): string | null {
  const n = name.toLowerCase().trim();
  for (const [canon, alts] of Object.entries(CANONICAL_STATES)) {
    if (canon === n || alts.includes(n)) return canon;
  }
  return null;
}

export function classifyPatternName(name: string): Classification | null {
  const n = normalizeName(name);
  for (const p of PATTERN_TYPES) {
    if (normalizeName(p.name) === n || p.slug === n.replace(/ /g, "-")) return { slug: p.slug, method: `alias-exact:${n}`, confidence: 0.85 };
  }
  for (const p of PATTERN_TYPES) {
    for (const a of p.aliases) {
      const an = normalizeName(a);
      if (an === n) return { slug: p.slug, method: `alias-exact:${an}`, confidence: 0.8 };
    }
  }
  for (const p of PATTERN_TYPES) {
    for (const a of p.aliases) {
      const an = normalizeName(a);
      if (an.length >= 4 && new RegExp(`(^| )${an}( |$)`).test(n)) return { slug: p.slug, method: `alias-contained:${an}`, confidence: 0.55 };
    }
  }
  return null;
}

export const componentTypeBySlug = new Map(COMPONENT_TYPES.map((c) => [c.slug, c]));
export const groupBySlug = new Map(COMPONENT_GROUPS.map((g) => [g.slug, g]));
export { normalizeName };
