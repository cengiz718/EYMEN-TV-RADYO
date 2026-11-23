import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { logAppError } from '../utils/errorLogger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message || 'Beklenmeyen bir arayüz hatası oluştu.',
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError('react', error?.message || 'React ErrorBoundary', info?.componentStack?.slice(0, 250));
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetCacheAndReload = () => {
    try {
      localStorage.removeItem('optis_custom_playlist');
      localStorage.removeItem('eymen_external_cache_v1');
      localStorage.removeItem('eymen_vod_playlist');
    } catch {
      // ignore
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh w-full flex items-center justify-center bg-[#0a0c10] text-slate-100 p-6">
          <div className="w-full max-w-md rounded-2xl bg-[#111827] border border-amber-500/40 p-6 text-center shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-base font-extrabold text-white">
                Eymen TV &amp; Radyo Kurtarma Modu
              </h1>
              <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">
                Beyaz ekranı önlemek için güvenli kurtarma ekranı açıldı. Favorileriniz ve ayarlarınız korunur.
              </p>
              {this.state.errorMessage && (
                <div className="mt-2 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[11px] font-mono text-amber-300 break-words">
                  {this.state.errorMessage}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-amber-400 text-slate-950 text-xs font-extrabold hover:bg-amber-300"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Uygulamayı Yeniden Başlat</span>
              </button>
              <button
                type="button"
                onClick={this.handleResetCacheAndReload}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 border border-white/15 text-slate-200 text-xs font-semibold hover:border-amber-400"
              >
                <Trash2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Liste Önbelleğini Temizle</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
