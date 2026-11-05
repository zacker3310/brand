import type { ARIAButtonSlotProps } from '@fluentui/react-aria';
import type { ComponentProps } from '@fluentui/react-utilities';
import type { ComponentState } from '@fluentui/react-utilities';
import type { DistributiveOmit } from '@fluentui/react-utilities';
import type { ForwardRefComponent } from '@fluentui/react-utilities';
import type { JSXElement } from '@fluentui/react-utilities';
import * as React_2 from 'react';
import type { Slot } from '@fluentui/react-utilities';
import type { SlotClassNames } from '@fluentui/react-utilities';

/**
 * Buttons give people a way to trigger an action.
 */
export declare const Button: ForwardRefComponent<ButtonProps>;

/**
 * Internal context provider used to update default values between internal components
 *
 * @internal
 */
export declare const ButtonContextProvider: React_2.Provider<ButtonContextValue | undefined>;

export declare type ButtonProps = ComponentProps<ButtonSlots> & {
    /**
     * A button can have its content and borders styled for greater emphasis or to be subtle.
     * - 'secondary' (default): Gives emphasis to the button in such a way that it indicates a secondary action.
     * - 'primary': Emphasizes the button as a primary action.
     * - 'outline': Removes background styling.
     * - 'subtle': Minimizes emphasis to blend into the background until hovered or focused.
     * - 'transparent': Removes background and border styling.
     *
     * @default 'secondary'
     */
    appearance?: 'secondary' | 'primary' | 'outline' | 'subtle' | 'transparent';
    /**
     * When set, allows the button to be focusable even when it has been disabled. This is used in scenarios where it
     * is important to keep a consistent tab order for screen reader and keyboard users. The primary example of this
     * pattern is when the disabled button is in a menu or a commandbar and is seldom used for standalone buttons.
     *
     * @default false
     */
    disabledFocusable?: boolean;
    /**
     * A button can show that it cannot be interacted with.
     *
     * @default false
     */
    disabled?: boolean;
    /**
     * A button can format its icon to appear before or after its content.
     *
     * @default 'before'
     */
    iconPosition?: 'before' | 'after';
    /**
     * A button can be rounded, circular, or square.
     *
     * @default 'rounded'
     */
    shape?: 'rounded' | 'circular' | 'square';
    /**
     * A button supports different sizes.
     *
     * @default 'medium'
     */
    size?: ButtonSize;
};

/**
 * A button supports different sizes.
 */
declare type ButtonSize = 'small' | 'medium' | 'large';

export declare type ButtonSlots = {
    /**
     * Root of the component that renders as either a `<button>` tag or an `<a>` tag.
     */
    root: NonNullable<Slot<ARIAButtonSlotProps<'a'>>>;
    /**
     * Icon that renders either before or after the `children` as specified by the `iconPosition` prop.
     */
    icon?: Slot<'span'>;
};

/**
 * ToggleButtons are buttons that toggle between two defined states when triggered.
 */
export declare const ToggleButton: ForwardRefComponent<ToggleButtonProps>;

export declare type ToggleButtonProps = ButtonProps & {
    /**
     * Defines whether the `ToggleButton` is initially in a checked state or not when rendered.
     *
     * @default false
     */
    defaultChecked?: boolean;
    /**
     * Defines the controlled checked state of the `ToggleButton`.
     * If passed, `ToggleButton` ignores the `defaultChecked` property.
     * This should only be used if the checked state is to be controlled at a higher level and there is a plan to pass the
     * correct value based on handling `onClick` events and re-rendering.
     *
     * @default false
     */
    checked?: boolean;
    /**
     * Defines whether the `ToggleButton` should use the alternate selected styles that have adequate contrast with the rest style
     *
     * @default false
     */
    isAccessible?: boolean;
};

/**
 * Breadcrumb component - TODO: add more docs
 */
declare const Breadcrumb_2: ForwardRefComponent<BreadcrumbProps>;
export { Breadcrumb_2 as Breadcrumb }

export declare type BreadcrumbProps = ComponentProps<BreadcrumbSlots> & Pick<PortalProps, 'mountNode'> & {
    /**
     * Sets the focus behavior for the Breadcrumb.
     *
     * @default 'tab'
     */
    focusMode?: 'arrow' | 'tab';
};

export declare type BreadcrumbSlots = {
    root: Slot<'nav'>;
    list?: Slot<'ol'>;
};
