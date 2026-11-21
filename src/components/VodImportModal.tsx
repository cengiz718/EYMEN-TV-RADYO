import { useRef, useState } from 'react';
import { CloudDownload, FileUp, Film, KeyRound, Trash2, X } from 'lucide-react';
import type { XtreamSeriesEntry, XtreamVodAuth } from '../types/channel';

type VodSourceTab = 'url' | 'file' | 'xtream';

interface VodImportModalProps {
  isOpen: boolean;
  savedVodUrl: string;
  hasVodItems: boolean;
  onClose: () => void;
  onImportVodUrl: (url: string) => Promise<void>;
  onImportVodFile: (content: string, filename: string) => void;
  onImportXtreamVod: (
    server: string,
    username: string,
    password: string
  ) => Promise<{
    content: string;
    series: XtreamSeriesEntry[];
    xtreamAuth: XtreamVodAuth;
  }>;
  onClearVodList: () => void;
}

export function VodImportModal({
  isOpen,
  savedVodUrl,
  hasVodItems,
  onClose,
  onImportVodUrl,
  onImportVodFile,
  onImportXtreamVod,
  onClearVodList,
}: VodImportModalProps) {
  const [tab, setTab] = useState<VodSourceTab>('url');
  const [urlInput, setUrlInput] = useState(savedVodUrl);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [xtreamServer, setXtreamServer] = useState('');
  const [xtreamUser, setXtreamUser] = useState('');
  const [xtreamPass, setXtreamPass] = useState('');

  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleSubmitUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setErrorMsg(null);
    setIsBusy(true);
    try {
      await onImportVodUrl(urlInput.trim());
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Liste yüklenemedi.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.includes('#EXTM3U') && !text.includes('#EXTINF')) {
        setErrorMsg('Seçilen dosya geçerli bir M3U / M3U8 listesi değil.');
        return;
      }
      onImportVodFile(text, file.name);
      onClose();
    } catch {
      setErrorMsg('Dosya okunamadı.');
    }
  };

  const handleSubmitXtream = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!xtreamServer.trim() || !xtreamUser.trim() || !xtreamPass.trim()) {
      setErrorMsg('Sunucu, kullanıcı adı ve şifre alanlarını doldurun.');
      return;
    }
    setIsBusy(true);
    try {
      await onImportXtreamVod(
        xtreamServer.trim(),
        xtreamUser.trim(),
        xtreamPass.trim()
      );
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Xtream Film/Dizi listesi alınamadı.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 bg-[var(--surface-2)] border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <div>
              <h2 className="text-base font-extrabold text-[var(--ink)]">
                Film &amp; Dizi Listesi Ekle
              </h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                Eklediğiniz içerikler türlerine ve gruplarına göre otomatik kategorilere ayrılır.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 p-2 bg-[var(--bg)] border-b border-[var(--border)]">
          <button
            type="button"
            onClick={() => {
              setTab('url');
              setErrorMsg(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-colors ${
              tab === 'url'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]'
            }`}
          >
            <CloudDownload className="w-3.5 h-3.5" />
            <span>M3U URL</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTab('file');
              setErrorMsg(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-colors ${
              tab === 'file'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]'
            }`}
          >
            <FileUp className="w-3.5 h-3.5" />
            <span>Dosya Seç</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTab('xtream');
              setErrorMsg(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-colors ${
              tab === 'xtream'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Xtream VOD</span>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {tab === 'url' && (
            <form onSubmit={handleSubmitUrl} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5">
                  Film / Dizi M3U veya M3U8 Bağlantısı
                </label>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://.../filmler-ve-diziler.m3u"
                  className="w-full rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--ink)] placeholder-[var(--muted)]/60 focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              {errorMsg && (
                <div className="text-xs font-medium text-[var(--live)]">{errorMsg}</div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                {hasVodItems ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClearVodList();
                      onClose();
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[var(--live)] hover:bg-white/5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Listeyi Temizle</span>
                  </button>
                ) : (
                  <span />
                )}

                <button
                  type="submit"
                  disabled={!urlInput.trim() || isBusy}
                  className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] disabled:opacity-40"
                >
                  {isBusy ? 'Yükleniyor...' : 'Ekle ve Kategorileri Oluştur'}
                </button>
              </div>
            </form>
          )}

          {tab === 'file' && (
            <div className="space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept=".m3u,.m3u8,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full py-6 px-4 rounded-xl border border-dashed border-[var(--accent)]/60 bg-[var(--bg)] hover:bg-[var(--surface-elevated)] flex flex-col items-center justify-center gap-2 transition-colors"
              >
                <FileUp className="w-7 h-7 text-[var(--accent)]" />
                <span className="text-sm font-bold text-[var(--ink)]">
                  Cihazdan Film / Dizi M3U Dosyası Seç
                </span>
                <span className="text-xs text-[var(--muted)]">
                  Filmler, diziler ve tür kategorileri otomatik ayrıştırılır
                </span>
              </button>
              {errorMsg && (
                <div className="text-xs font-medium text-[var(--live)]">{errorMsg}</div>
              )}
            </div>
          )}

          {tab === 'xtream' && (
            <form onSubmit={handleSubmitXtream} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--muted)] mb-1">
                  Sunucu Adresi (Host / URL)
                </label>
                <input
                  type="url"
                  value={xtreamServer}
                  onChange={(e) => setXtreamServer(e.target.value)}
                  placeholder="http://sunucu.ornek:8080"
                  className="w-full rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-[var(--muted)] mb-1">
                    Kullanıcı Adı
                  </label>
                  <input
                    type="text"
                    value={xtreamUser}
                    onChange={(e) => setXtreamUser(e.target.value)}
                    placeholder="kullanici"
                    className="w-full rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--muted)] mb-1">
                    Şifre
                  </label>
                  <input
                    type="password"
                    value={xtreamPass}
                    onChange={(e) => setXtreamPass(e.target.value)}
                    placeholder="••••••"
                    className="w-full rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
              {errorMsg && (
                <div className="text-xs font-medium text-[var(--live)]">{errorMsg}</div>
              )}
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isBusy}
                  className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {isBusy ? 'İndiriliyor...' : 'Filmleri ve Dizileri Çek'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
