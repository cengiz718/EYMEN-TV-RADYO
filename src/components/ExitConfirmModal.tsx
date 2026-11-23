import { useEffect, useRef } from 'react';
import { LogOut, Tv } from 'lucide-react';
import { AppLogoBadge } from './BrandMark';
import { useIdleAutoClose } from '../hooks/useIdleAutoClose';

interface ExitConfirmModalProps {
  isOpen: boolean;
  menuAutoCloseSeconds?: number;
  onConfirmExit: () => void;
  onCancel: () => void;
}

export function ExitConfirmModal({
  isOpen,
  menuAutoCloseSeconds = 5,
  onConfirmExit,
  onCancel,
}: ExitConfirmModalProps) {
  const noBtnRef = useRef<HTMLButtonElement | null>(null);
  const yesBtnRef = useRef<HTMLButtonElement | null>(null);

  useIdleAutoClose(isOpen, menuAutoCloseSeconds, onCancel);

  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => {
      noBtnRef.current?.focus();
    }, 30);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        yesBtnRef.current?.focus();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        noBtnRef.current?.focus();
      } else if (
        e.key === 'Escape' ||
        e.key === 'GoBack' ||
        e.key === 'BrowserBack' ||
        e.key === 'Backspace'
      ) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', handleKey, true);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-confirm-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-[var(--surface)] border border-[var(--border-strong)] p-5 shadow-2xl text-center space-y-4"
      >
        <div className="mx-auto flex justify-center">
          <AppLogoBadge className="w-14 h-14" />
        </div>

        <div>
          <h2
            id="exit-confirm-title"
            className="text-base font-extrabold text-[var(--ink)]"
          >
            Uygulamadan çıkılsın mı?
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Eymen TV &amp; Radyo kapatılsın mı?
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            ref={yesBtnRef}
            type="button"
            onClick={onConfirmExit}
            className="min-h-[44px] py-2.5 px-4 rounded-xl bg-[var(--live)] text-white text-sm font-extrabold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            <span>Evet</span>
          </button>

          <button
            ref={noBtnRef}
            type="button"
            onClick={onCancel}
            className="min-h-[44px] py-2.5 px-4 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-extrabold hover:bg-[var(--accent-hover)] transition-colors flex items-center justify-center gap-1.5"
          >
            <Tv className="w-4 h-4" />
            <span>Hayır</span>
          </button>
        </div>
      </div>
    </div>
  );
}
