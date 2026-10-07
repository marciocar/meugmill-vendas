import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useHost } from './host-context';

interface DropdownProps {
  label: string;
  children: ReactNode;
}

/**
 * Dropdown simples. O menu abre num portal cujo container fica dentro do
 * shadow root (e não em document.body), para herdar o CSS isolado.
 */
export function Dropdown({ label, children }: DropdownProps) {
  const { portalContainer } = useHost();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX });
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="gc-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        {label}
      </button>
      {open &&
        portalContainer &&
        createPortal(
          <>
            <div className="gc-backdrop" onClick={() => setOpen(false)} />
            <ul id={menuId} role="menu" className="gc-menu" style={pos}>
              {children}
            </ul>
          </>,
          portalContainer,
        )}
    </>
  );
}
