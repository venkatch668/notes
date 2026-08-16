/**
 * The dialog primitives.
 *
 * One place that knows how a dialog behaves, so every dialog behaves the same:
 * Escape closes it, the scrim closes it, a click inside never does, focus lands
 * somewhere useful on open and returns to wherever it came from on close, and
 * the page behind does not scroll while it is up.
 *
 * These replace `window.prompt` / `window.confirm`, which are worth removing
 * for reasons beyond looks: they block the JS thread, cannot be styled or
 * labelled, are silently suppressed in some embedded contexts, and offer
 * exactly one text field and two buttons — so "save / discard / cancel" has to
 * be squeezed into OK-versus-Cancel, where Cancel ambiguously means both
 * "don't leave" and "leave without saving".
 */

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** `sm` for a single question, `md` for a form, `lg` for a review. */
  size?: 'sm' | 'md' | 'lg';
  /** Hide the × when the dialog must be answered rather than dismissed. */
  dismissible?: boolean;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;

    // The page behind must not scroll under the scrim — on a phone that
    // scrolling steals the gesture and the dialog feels broken.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first thing worth typing into, falling back to the panel so
    // that Escape and Tab have somewhere to start from.
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), textarea, select, button.btn-primary',
    );
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onClose();
        return;
      }

      // Keep Tab inside the dialog. Without this, tabbing walks into the note
      // behind and keystrokes land in a contenteditable the user cannot see.
      if (e.key !== 'Tab' || !panel) return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      returnFocusTo.current?.focus?.();
    };
  }, [onClose, dismissible]);

  // Portalled to <body> so the dialog is never laid out inside the app shell.
  // `.app` is a grid and `.workspace` a positioned grid; anything rendered in
  // there is subject to their tracks and stacking, which is how a centred
  // overlay ends up pinned to a column edge.
  return createPortal(
    <div className="scrim scrim--dialog" onMouseDown={dismissible ? onClose : undefined}>
      <div
        ref={panelRef}
        className={`dlg dlg--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="dlg__head">
          <div>
            <h2 className="dlg__title" id={titleId}>
              {title}
            </h2>
            {subtitle && <p className="dlg__subtitle">{subtitle}</p>}
          </div>
          {dismissible && (
            <button type="button" className="dlg__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </header>

        {children && <div className="dlg__body">{children}</div>}
        {footer && <footer className="dlg__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ Prompt */

/** OneNote's section palette — the same swatches the nav rows already show. */
const COLORS = ['#7719AA', '#0F6CBD', '#107C10', '#C239B3', '#D83B01', '#E3008C', '#00898A'];

interface PromptProps {
  title: string;
  subtitle?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  /** Show the colour picker — notebooks and sections carry one, pages do not. */
  withColor?: boolean;
  onSubmit: (value: string, color: string) => Promise<void> | void;
  onClose: () => void;
}

export function PromptModal({
  title,
  subtitle,
  label,
  placeholder,
  initialValue = '',
  submitLabel = 'Create',
  withColor = false,
  onSubmit,
  onClose,
}: PromptProps) {
  const [value, setValue] = useState(initialValue);
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const name = value.trim();
    // Validated inline rather than by refusing to close: a disabled button with
    // no explanation is the most common way a form dead-ends.
    if (!name) {
      setError('Give it a name first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name, color);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={busy}
          >
            {busy ? 'Working…' : submitLabel}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">{label}</span>
        <input
          className="form-control"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          // Enter submits: a one-field dialog that needs a mouse click to
          // finish is a dialog that gets abandoned.
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>

      {withColor && (
        <div className="field">
          <span className="field__label">Colour</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${c === color ? 'swatch--on' : ''}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
      )}

      {error && <p className="field__error">{error}</p>}
    </Modal>
  );
}

/* ----------------------------------------------------------------- Confirm */

interface ConfirmChoice {
  label: string;
  value: string;
  variant?: 'primary' | 'danger' | 'ghost';
}

interface ConfirmProps {
  title: string;
  message: string;
  choices: ConfirmChoice[];
  onChoose: (value: string) => void;
}

/**
 * A confirm that can offer more than two answers.
 *
 * "Save, discard, or stay here" is three outcomes; `window.confirm` has two,
 * which is why the old unsaved-changes dialog had to explain itself with
 * "OK = save, Cancel = discard" and still gave no way to simply stay put.
 */
export function ConfirmModal({ title, message, choices, onChoose }: ConfirmProps) {
  const cancel = choices.find((c) => c.variant === 'ghost') ?? choices[choices.length - 1];

  return (
    <Modal
      title={title}
      size="sm"
      onClose={() => onChoose(cancel.value)}
      footer={choices.map((c) => (
        <button
          key={c.value}
          type="button"
          className={
            c.variant === 'primary'
              ? 'btn btn-primary btn-sm'
              : c.variant === 'danger'
                ? 'btn btn-outline-danger btn-sm'
                : 'btn btn-outline-secondary btn-sm'
          }
          onClick={() => onChoose(c.value)}
        >
          {c.label}
        </button>
      ))}
    >
      <p className="dlg__message">{message}</p>
    </Modal>
  );
}
