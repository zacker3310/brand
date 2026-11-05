import React from 'react';
import type { Size, Tone } from './types';
interface NonMutuallyExclusiveProps {
    /** The content to display inside the badge. */
    children?: string;
    /** Colors and labels the badge with the given tone. */
    tone?: Tone;
    /**
     * @default 'medium'
     */
    size?: Size;
}
export type BadgeProps = NonMutuallyExclusiveProps & ({
    progress?: 'incomplete' | 'complete';
    icon?: undefined;
} | {
    icon?: string;
    progress?: undefined;
});
export declare function Badge({ children, tone, size, }: BadgeProps): React.JSX.Element;
export {};
