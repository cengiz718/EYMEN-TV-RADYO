import { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] transition-colors"
      >
        <Download className="w-4 h-4" />
        <span>Cihaza Uygulama Olarak Kur (PWA)</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[var(--bg)] border border-[var(--accent)]/60 text-[var(--accent)] text-xs font-bold hover:bg-[var(--surface-elevated)] transition-colors"
        >
          <Smartphone className="w-4 h-4" />
          <span>iPhone / iPad Ana Ekrana Ekle</span>
        </button>

        {showIOSGuide && (
          <div
            onClick={() => setShowIOSGuide(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          >
            <div
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5 shadow-2xl space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-[var(--ink)]">
                  iPhone / iPad Kurulumu
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--ink)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                1. Safari alt çubuğundaki <strong className="text-[var(--ink)]">Paylaş</strong> simgesine dokunun.
                <br />
                2. Aşağı kaydırıp <strong className="text-[var(--ink)]">Ana Ekrana Ekle</strong> seçeneğine basın.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold"
              >
                Anladım
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
