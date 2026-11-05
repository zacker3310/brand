import React from 'react';
import type { BaseButton, IconSource } from '../../types';
export interface ButtonProps extends BaseButton {
    /** The content to display inside the button */
    children?: string | string[];
    /**
     * Changes the size of the button, giving it more or less padding
     * @default 'medium'
     */
    size?: 'micro' | 'slim' | 'medium' | 'large';
    /** Removes underline from button text (including on interaction)
     * @deprecated Use a variant instead
     */
    removeUnderline?: boolean;
    /** Icon to display to the left of the button content */
    icon?: React.ReactElement | IconSource;
    /** Sets the color treatment of the Button. */
    tone?: 'critical' | 'success';
    /** Changes the visual appearance of the Button. */
    variant?: 'plain' | 'primary' | 'secondary' | 'tertiary' | 'monochromePlain';
}
export declare function Button({ id, children, url, disabled, loading, pressed, icon, size, tone, variant, }: ButtonProps): React.JSX.Element;
//# sourceMappingURL=Button.d.ts.map
