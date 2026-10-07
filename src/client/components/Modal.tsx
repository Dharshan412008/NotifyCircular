import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps { open: boolean; onClose: () => void; eyebrow?: string; title: string; children: ReactNode; className?: string; dismissible?: boolean }

export default function Modal({
  open,
  onClose,
  eyebrow,
  title,
  children,
  className = '',
  dismissible = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`sheet-dialog ${className}`.trim()}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(event) => {
        if (dismissible && event.target === dialogRef.current) onClose();
      }}
    >
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div>
            {eyebrow && <p className="overline">{eyebrow}</p>}
            <h3 id={titleId}>{title}</h3>
          </div>
          {dismissible && (
            <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
