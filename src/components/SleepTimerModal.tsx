import { X } from 'lucide-react';
import { useIdleAutoClose } from '../hooks/useIdleAutoClose';

interface SleepTimerModalProps {
  isOpen: boolean;
  menuAutoCloseSeconds?: number;
  onClose: () => void;
  onSelectMinutes: (minutes: number | null) => void;
}

const DURATIONS = [15, 30, 45, 60, 90];

export function SleepTimerModal({
  isOpen,
  menuAutoCloseSeconds = 5,
  onClose,
  onSelectMinutes,
}: SleepTimerModalProps) {
  useIdleAutoClose(isOpen, menuAutoCloseSeconds, onClose);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-[var(--ink)]">
            Uyku Zamanlayıcısı (TV / Radyo)
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          {DURATIONS.map((mins) => (
            <button
              key={mins}
              type="button"
              onClick={() => {
                onSelectMinutes(mins);
                onClose();
              }}
              className="w-full py-2.5 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] text-sm font-semibold text-[var(--ink)] hover:border-[var(--accent)] hover:bg-[var(--surface-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-colors"
            >
              <span className="font-mono-nums">{mins}</span> Dakika Sonra Kapat
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onSelectMinutes(null);
              onClose();
            }}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-[var(--live)] hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--live)] transition-colors"
          >
            Zamanlayıcıyı İptal Et
          </button>
        </div>
      </div>
    </div>
  );
}
