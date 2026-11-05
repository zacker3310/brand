/**
 * WAI-ARIA references for component_type.aria_pattern values.
 *
 * The taxonomy stores a mix of APG pattern slugs and plain ARIA role names. Linking blindly to
 * https://www.w3.org/WAI/ARIA/apg/patterns/<value>/ would produce broken links for role names, so
 * this table was checked by HTTP on 2026-11-05: values with a dedicated APG pattern page link
 * there (following redirects, e.g. menu -> menubar); role-only values link to the role definition
 * in WAI-ARIA 1.2 (anchor ids confirmed present in https://www.w3.org/TR/wai-aria-1.2/).
 * Unknown values get no link rather than a guessed one.
 */

export interface AriaReference {
  kind: "apg-pattern" | "aria-role";
  value: string;
  label: string;
  url: string;
}

const APG = "https://www.w3.org/WAI/ARIA/apg/patterns/";
const ARIA_SPEC = "https://www.w3.org/TR/wai-aria-1.2/#";

/** aria_pattern value -> [APG page slug, page title]. Verified 200 OK on 2026-11-05. */
const APG_PATTERNS: Record<string, [string, string]> = {
  accordion: ["accordion", "Accordion pattern"],
  alert: ["alert", "Alert pattern"],
  alertdialog: ["alertdialog", "Alert and Message Dialogs pattern"],
  breadcrumb: ["breadcrumb", "Breadcrumb pattern"],
  button: ["button", "Button pattern"],
  carousel: ["carousel", "Carousel pattern"],
  checkbox: ["checkbox", "Checkbox pattern"],
  combobox: ["combobox", "Combobox pattern"],
  "dialog-modal": ["dialog-modal", "Dialog (Modal) pattern"],
  disclosure: ["disclosure", "Disclosure pattern"],
  grid: ["grid", "Grid pattern"],
  link: ["link", "Link pattern"],
  listbox: ["listbox", "Listbox pattern"],
  menu: ["menubar", "Menu and Menubar pattern"], // /patterns/menu/ 301 -> /patterns/menubar/
  menubar: ["menubar", "Menu and Menubar pattern"],
  "menu-button": ["menu-button", "Menu Button pattern"],
  meter: ["meter", "Meter pattern"],
  radio: ["radio", "Radio Group pattern"],
  slider: ["slider", "Slider pattern"],
  spinbutton: ["spinbutton", "Spinbutton pattern"],
  switch: ["switch", "Switch pattern"],
  table: ["table", "Table pattern"],
  tabs: ["tabs", "Tabs pattern"],
  toolbar: ["toolbar", "Toolbar pattern"],
  tooltip: ["tooltip", "Tooltip pattern"],
  treeview: ["treeview", "Tree View pattern"],
  "window-splitter": ["windowsplitter", "Window Splitter pattern"], // /patterns/window-splitter/ is 404
  windowsplitter: ["windowsplitter", "Window Splitter pattern"],
};

/** Values that are ARIA roles without a dedicated APG pattern page. Anchors verified in WAI-ARIA 1.2. */
const ARIA_ROLES = new Set(["textbox", "searchbox", "dialog", "navigation", "list", "separator"]);

export function ariaReference(pattern: string | null | undefined): AriaReference | null {
  if (!pattern) return null;
  const v = pattern.trim().toLowerCase();
  const apg = APG_PATTERNS[v];
  if (apg) return { kind: "apg-pattern", value: v, label: apg[1], url: `${APG}${apg[0]}/` };
  if (ARIA_ROLES.has(v)) return { kind: "aria-role", value: v, label: `“${v}” role (WAI-ARIA 1.2)`, url: `${ARIA_SPEC}${v}` };
  return null;
}

/** Display label for an interaction-pattern facet value. */
export function ariaPatternLabel(pattern: string): string {
  const ref = ariaReference(pattern);
  if (ref?.kind === "apg-pattern") return ref.label.replace(/ pattern$/, "");
  return pattern;
}
