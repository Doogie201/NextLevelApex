"use client";

/**
 * TooltipStyles — CSS-only tooltip system for all `button[aria-label]` elements.
 *
 * Renders a single <style> tag. Tooltips appear on hover and focus-visible,
 * deriving content from `aria-label`. No JS state, no deps, hover + keyboard
 * focus parity. Respects prefers-reduced-motion.
 */
export default function TooltipStyles() {
  return (
    <style>{`
      button[aria-label] {
        position: relative;
      }
      button[aria-label]::after {
        content: attr(aria-label);
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 10px;
        border-radius: 6px;
        background: var(--surface-strong, #1a1a2e);
        color: var(--foreground, #e0e0e0);
        font-size: 0.75rem;
        line-height: 1.3;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        z-index: 9999;
        transition: opacity 0.15s ease-in;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        border: 1px solid var(--surface-border, #333);
        max-width: 260px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      button[aria-label]:hover::after,
      button[aria-label]:focus-visible::after {
        opacity: 1;
        transition-delay: 0.45s;
      }
      button[aria-label]:active::after {
        opacity: 0;
        transition-delay: 0s;
      }
      /* Flip tooltip below when near the top of the viewport */
      .top-healthbar button[aria-label]::after {
        bottom: auto;
        top: calc(100% + 6px);
      }
      /* Anchor left for nav buttons to prevent overflow */
      .left-nav button[aria-label]::after {
        left: 0;
        transform: none;
      }
      @media (prefers-reduced-motion: reduce) {
        button[aria-label]::after {
          transition: none;
        }
        button[aria-label]:hover::after,
        button[aria-label]:focus-visible::after {
          transition-delay: 0s;
        }
      }
    `}</style>
  );
}
