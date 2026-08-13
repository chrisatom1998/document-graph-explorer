import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface CloseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Accessible text label for screen readers.
   * @default "Close"
   */
  'aria-label'?: string;
  /**
   * Tooltip title on hover.
   * Defaults to `aria-label` or "Close".
   */
  title?: string;
}

/**
 * Shared accessible close button component for dialogs, panels, and popovers.
 * Standardizes styling (`icon-btn-close`), multiplication symbol glyph (`✕`),
 * forwardRef for focus management, and accessible defaults.
 */
export const CloseButton = forwardRef<HTMLButtonElement, CloseButtonProps>(
  function CloseButton(
    {
      'aria-label': ariaLabel = 'Close',
      title,
      type = 'button',
      className = 'icon-btn-close',
      children = '✕',
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={className}
        aria-label={ariaLabel}
        title={title ?? ariaLabel}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export default CloseButton;
