import React from 'react';
import type { FooterProps } from './components';
export type ModalSize = 'small' | 'large' | 'fullScreen';
export interface ModalProps extends Omit<FooterProps, 'footer'> {
    /** Whether the modal is open or not */
    open: boolean;
    /** The size of the modal */
    size?: ModalSize;
    /** Callback when the modal is closed */
    onClose(): void;
}
export declare const Modal: React.FunctionComponent<ModalProps>;
