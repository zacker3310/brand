import React from 'react';
import type { ComplexAction } from '../../../../types';
export interface FooterProps {
    /** Primary action */
    primaryAction?: ComplexAction;
    /** Collection of secondary actions */
    secondaryActions?: ComplexAction[];
    /** Inner content of the footer */
    footer?: React.ReactNode;
}
export declare function Footer({ primaryAction, secondaryActions, footer }: FooterProps): React.JSX.Element;
