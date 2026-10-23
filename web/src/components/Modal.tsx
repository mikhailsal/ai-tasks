import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';

function outside(event: PointerEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const bounds = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  );
}

/** Dismissal only cancels. Applying a dialog requires its own explicit control. */
export function Modal({
  open,
  onCancel,
  children,
  labelledBy,
  label,
  className,
}: {
  open: boolean;
  onCancel: () => void;
  children: ReactNode;
  labelledBy?: string;
  label?: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const startedOutside = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
    return () => {
      if (element?.open) element.close();
    };
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className={className}
      aria-labelledby={labelledBy}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      onPointerDown={(event) => {
        startedOutside.current = outside(event);
      }}
      onPointerUp={(event) => {
        if (startedOutside.current && outside(event)) onCancel();
        startedOutside.current = false;
      }}
      onPointerCancel={() => {
        startedOutside.current = false;
      }}
    >
      {children}
    </dialog>
  );
}
