// Trimmed excerpt of @fluentui/web-components@3.1.4 dist/web-components.d.ts (MIT, Copyright (c) Microsoft Corporation).

/**
 * A Button Custom HTML Element.
 * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button | `<button>`} element.
 *
 * @slot start - Content which can be provided before the button content
 * @slot end - Content which can be provided after the button content
 * @slot - The default slot for button content
 * @csspart content - The button content container
 *
 * @public
 */
export declare class BaseButton extends FASTElement {    /**
     * Default slotted content.
     *
     * @public
     */
    defaultSlottedContent: HTMLElement[];
    /**
     * Sets the element's disabled state.
     * @see The {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#disabled | `disabled`} attribute
     *
     * @public
     * @remarks
     * HTML Attribute: `disabled`
     */
    disabled: boolean;
    /**
     * Handles changes to the disabled attribute. If the button is disabled, it
     * should not be focusable.
     *
     * @param previous - the previous disabled value
     * @param next - the new disabled value
     * @internal
     */
    disabledChanged(): void;
    /**
     * Indicates that the button is focusable while disabled.
     *
     * @public
     * @remarks
     * HTML Attribute: `disabled-focusable`
     */
    disabledFocusable: boolean;
    /**
     * The internal {@link https://developer.mozilla.org/en-US/docs/Web/API/ElementInternals | `ElementInternals`} instance for the component.
     *
     * @internal
     */
    elementInternals: ElementInternals;
    /**
     * The associated form element.
     *
     * @public
     */
    get form(): HTMLFormElement | null;
    /**
     * The button type.
     * @see The {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#type | `type`} attribute
     *
     * @public
     * @remarks
     * HTML Attribute: `type`
     */
    type: ButtonType;
}

/**
 * A Button Custom HTML Element.
 * Based on BaseButton and includes style and layout specific attributes
 *
 * @tag fluent-button
 *
 * @public
 */
export declare class Button extends BaseButton {    /**
     * Indicates the styled appearance of the button.
     *
     * @public
     * @remarks
     * HTML Attribute: `appearance`
     */
    appearance?: ButtonAppearance;
    /**
     * The shape of the button.
     *
     * @public
     * @remarks
     * HTML Attribute: `shape`
     */
    shape?: ButtonShape;
    /**
     * The size of the button.
     *
     * @public
     * @remarks
     * HTML Attribute: `size`
     */
    size?: ButtonSize;
    /**
     * Indicates that the button should only display as an icon with no text content.
     *
     * @public
     * @remarks
     * HTML Attribute: `icon-only`
     */
    iconOnly: boolean;
}

/**
 * ButtonAppearance constants
 * @public
 */
export declare const ButtonAppearance: {
    readonly primary: "primary";
    readonly outline: "outline";
    readonly subtle: "subtle";
    readonly transparent: "transparent";
};

/**
 * A Button can be secondary, primary, outline, subtle, transparent
 * @public
 */
export declare type ButtonAppearance = ValuesOf<typeof ButtonAppearance>;

/**
 * A Button can be square, circular or rounded.
 * @public
 */
export declare const ButtonShape: {
    readonly circular: "circular";
    readonly rounded: "rounded";
    readonly square: "square";
};

/**
 * A Button can be square, circular or rounded
 * @public
 */
export declare type ButtonShape = ValuesOf<typeof ButtonShape>;

/**
 * A Button can be a size of small, medium or large.
 * @public
 */
export declare const ButtonSize: {
    readonly small: "small";
    readonly medium: "medium";
    readonly large: "large";
};

/**
 * A Button can be on of several preset sizes.
 * @public
 */
export declare type ButtonSize = ValuesOf<typeof ButtonSize>;

/**
 * Button type values.
 *
 * @public
 */
export declare const ButtonType: {
    readonly submit: "submit";
    readonly reset: "reset";
    readonly button: "button";
};

/**
 * Type for button type values.
 *
 * @public
 */
export declare type ButtonType = ValuesOf<typeof ButtonType>;

/**
 * The definition for the `<fluent-button>` element.
 *
 * @public
 */
export declare const ButtonDefinition: PartialFASTElementDefinition;

/**
 * The base class for a component with a toggleable checked state.
 *
 * @fires { Event } change - Fires a custom 'change' event when the checked state changes
 * @fires { Event } input - Fires a custom 'input' event when the checked state changes
 *
 * @public
 */
export declare class BaseCheckbox extends FASTElement {    /**
     * The element's current checked state.
     *
     * @public
     */
    get checked(): boolean;
    set checked(next: boolean);
    /**
     * The disabled state of the control.
     *
     * @public
     */
    disabled?: boolean;
    /**
     * The element's required state.
     *
     * @public
     * @remarks
     * HTML Attribute: `required`
     */
    required: boolean;
}

/**
 * A Checkbox Custom HTML Element.
 * Implements the {@link https://w3c.github.io/aria/#checkbox | ARIA checkbox }.
 *
 * @tag fluent-checkbox
 *
 * @slot checked-indicator - The checked indicator
 * @slot indeterminate-indicator - The indeterminate indicator
 * @fires { Event } change - Emits a custom change event when the checked state changes
 * @fires { Event } input - Emits a custom input event when the checked state changes
 *
 * @public
 */
export declare class Checkbox extends BaseCheckbox {    /**
     * Indicates that the element is in an indeterminate or mixed state.
     *
     * @public
     */
    indeterminate?: boolean;
    /**
     * Updates the indeterminate state when the `indeterminate` property changes.
     *
     * @param prev - the indeterminate state
     * @param next - the current indeterminate state
     * @internal
     */
    protected indeterminateChanged(prev: boolean | undefined, next: boolean | undefined): void;
    /**
     * Indicates the shape of the checkbox.
     *
     * @public
     * @remarks
     * HTML Attribute: `shape`
     */
    shape?: CheckboxShape;
    /**
     * Indicates the size of the control.
     *
     * @public
     * @remarks
     * HTML Attribute: `size`
     */
    size?: CheckboxSize;
    constructor();
}

/**
 * Checkbox shape
 * @public
 */
export declare const CheckboxShape: {
    readonly circular: "circular";
    readonly square: "square";
};

/** @public */
export declare type CheckboxShape = ValuesOf<typeof CheckboxShape>;

/**
 * The definition for the `<fluent-checkbox>` element.
 *
 * @public
 */
export declare const CheckboxDefinition: PartialFASTElementDefinition;

/**
 * A Switch Custom HTML Element.
 * Implements {@link https://www.w3.org/TR/wai-aria-1.1/#menuitem | ARIA menuitem }, {@link https://www.w3.org/TR/wai-aria-1.1/#menuitemcheckbox | ARIA menuitemcheckbox}, or {@link https://www.w3.org/TR/wai-aria-1.1/#menuitemradio | ARIA menuitemradio }.
 *
 * @tag fluent-menu-item
 *
 * @slot indicator - The checkbox or radio indicator
 * @slot start - Content which can be provided before the menu item content
 * @slot - The default slot for menu item content
 * @slot end - Content which can be provided after the menu item content
 * @slot submenu-glyph - The submenu expand/collapse indicator
 * @slot submenu - Used to nest menu's within menu items
 * @csspart content - The element wrapping the menu item content
 * @fires { Event } change - Fires a custom 'change' event when a non-submenu item with a role of `menuitemcheckbox`, `menuitemradio`, or `menuitem` is invoked
 *
 * @public
 */
export declare class MenuItem extends FASTElement {    /**
     * The disabled state of the element.
     *
     * @public
     * @remarks
     * HTML Attribute: disabled
     */
    disabled: boolean;
    /**
     * The role of the element.
     *
     * @public
     * @remarks
     * HTML Attribute: role
     */
    role: MenuItemRole;
    /**
     * The checked value of the element.
     *
     * @public
     * @remarks
     * HTML Attribute: checked
     */
    checked: boolean;
}

/**
 * The definition for the `<fluent-menu-item>` element.
 *
 * @public
 */
export declare const MenuItemDefinition: PartialFASTElementDefinition;

/**
 * CSS custom property value for the {@link @fluentui/tokens#borderRadiusXLarge | `borderRadiusXLarge`} design token.
 * @public
 */
export declare const borderRadiusXLarge = "var(--borderRadiusXLarge)";

declare type ValuesOf<T> = T[keyof T];
