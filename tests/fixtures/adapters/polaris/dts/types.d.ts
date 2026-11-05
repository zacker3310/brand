import type React from 'react';
export type Target = '_blank' | '_self' | '_parent' | '_top';
export type IconSource = React.FunctionComponent<React.SVGProps<SVGSVGElement>> | 'placeholder' | string;
export interface BaseButton {
    /** A unique identifier for the button */
    id?: string;
    /** A destination to link to, rendered in the href attribute of a link */
    url?: string;
    /** Where to display the url */
    target?: Target;
    /** Disables the button, disallowing merchant interaction */
    disabled?: boolean;
    /** Replaces button text with a spinner while a background action is being performed */
    loading?: boolean;
    /** Sets the button in a pressed state */
    pressed?: boolean;
    /** Callback when clicked */
    onClick?(): unknown;
    /** Callback when a keypress event is registered on the button */
    onKeyPress?(event: React.KeyboardEvent<HTMLButtonElement>): void;
}
export interface ComplexAction {
    /** Content the action displays */
    content?: string;
}
//# sourceMappingURL=types.d.ts.map
