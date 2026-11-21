import { useState, useEffect, useRef } from 'react';
import {
  Check,
  CloudDownload,
  Copy,
  FileJson,
  FileUp,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Share2,
  X,
} from 'lucide-react';

type SourceTab = 'm3u' | 'bulk' | 'file' | 'xtream' | 'transfer';

interface PlaylistUpdateModalProps {
  isOpen: boolean;
  savedUrl: string;
  mandatoryAutoUpdate: boolean;
  lastUpdatedAt: string | null;
  onClose: () => void;
  onSaveAndUpdate: (url: string, mandatory: boolean) => void;
  onAddBulkSources: (rawUrlsText: string, customName?: string) => Promise<void>;
  onImportLocalM3u: (content: string, filename: string) => void;
  onImportXtream: (server: string, username: string, password: string) => Promise<void>;
  onResetDefault: () => void;
}

export function PlaylistUpdateModal({
  isOpen,
  savedUrl,
  mandatoryAutoUpdate,
  lastUpdatedAt,
  onClose,
  onSaveAndUpdate,
  onAddBulkSources,
  onImportLocalM3u,
  onImportXtream,
  onResetDefault,
}: PlaylistUpdateModalProps) {
  const [tab, setTab] = useState<SourceTab>('m3u');
  const [inputUrl, setInputUrl] = useState(savedUrl);
  const [mandatory, setMandatory] = useState(mandatoryAutoUpdate);

  const [bulkName, setBulkName] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [xtreamServer, setXtreamServer] = useState('');
  const [xtreamUser, setXtreamUser] = useState('');
  const [xtreamPass, setXtreamPass] = useState('');
  const [xtreamLoading, setXtreamLoading] = useState(false);
  const [xtreamError, setXtreamError] = useState<string | null>(null);

  const [fileError, setFileError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setInputUrl(savedUrl);
      setMandatory(mandatoryAutoUpdate);
      setBulkError(null);
      setXtreamError(null);
      setFileError(null);
      setCopiedLink(false);
    }
  }, [isOpen, savedUrl, mandatoryAutoUpdate]);

  if (!isOpen) return null;

  const handleSubmitM3u = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;
    onSaveAndUpdate(inputUrl.trim(), mandatory);
    onClose();
  };

  const handleSubmitBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkError(null);
    if (!bulkText.trim()) {
      setBulkError('En az bir GitHub JSON veya M3U adresi girin.');
      return;
    }
    setBulkLoading(true);
    try {
      await onAddBulkSources(bulkText, bulkName.trim() || undefined);
      setBulkText('');
      setBulkName('');
      onClose();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Ek listeler eklenemedi.');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleSubmitXtream = async (e: React.FormEvent) => {
    e.preventDefault();
    setXtreamError(null);
    if (!xtreamServer.trim() || !xtreamUser.trim() || !xtreamPass.trim()) {
      setXtreamError('Tüm alanları eksiksiz doldurun.');
      return;
    }
    setXtreamLoading(true);
    try {
      await onImportXtream(xtreamServer.trim(), xtreamUser.trim(), xtreamPass.trim());
      onClose();
    } catch (err) {
      setXtreamError(
        err instanceof Error ? err.message : 'Xtream bağlantısı kurulamadı.'
      );
    } finally {
      setXtreamLoading(false);
    }
  };

  const handleLocalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const trimmed = text.trimStart();
      const isJson =
        file.name.toLowerCase().endsWith('.json') ||
        trimmed.startsWith('{') ||
        trimmed.startsWith('[');
      if (!isJson && !text.includes('#EXTM3U') && !text.includes('#EXTINF')) {
        setFileError('Seçilen dosya geçerli bir M3U, M3U8 veya JSON listesi değil.');
        return;
      }
      onImportLocalM3u(text, file.name);
      onClose();
    } catch {
      setFileError('Dosya okunamadı.');
    }
  };

  const transferUrl = savedUrl.trim()
    ? `${window.location.origin}/?m3u=${encodeURIComponent(savedUrl.trim())}`
    : window.location.origin;

  const handleCopyTransfer = async () => {
    try {
      await navigator.clipboard.writeText(transferUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore clipboard errors
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
          <div>
            <h2 className="text-base font-extrabold text-[var(--ink)]">
              Kanallar ve Toplu Listeler
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              M3U URL, GitHub JSON toplu liste, yerel dosya, Xtream veya TV aktarım linki kullanın.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Source Tabs */}
        <div className="grid grid-cols-5 gap-1 p-2 bg-[var(--bg)] border-b border-[var(--border)]">
          <button
            type="button"
            onClick={() => setTab('m3u')}
            className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              tab === 'm3u'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]'
            }`}
          >
            <CloudDownload className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">M3U URL</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('bulk')}
            className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              tab === 'bulk'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]'
            }`}
          >
            <FileJson className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">GitHub JSON</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('file')}
            className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              tab === 'file'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]'
            }`}
          >
            <FileUp className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Dosya</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('xtream')}
            className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              tab === 'xtream'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Xtream</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('transfer')}
            className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              tab === 'transfer'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]'
            }`}
          >
            <Share2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">TV Aktar</span>
          </button>
        </div>

        <div className="p-5">
          {tab === 'm3u' && (
            <form onSubmit={handleSubmitM3u} className="space-y-4">
              <div>
                <label
                  htmlFor="m3u-url-input"
                  className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                >
                  Ana M3U / M3U8 veya JSON Bağlantı Adresi
                </label>
                <input
                  id="m3u-url-input"
                  type="url"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="https://raw.githubusercontent.com/.../liste.json"
                  className="w-full rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--ink)] placeholder-[var(--muted)]/60 focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <label className="flex items-start gap-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mandatory}
                  onChange={(e) => setMandatory(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)] rounded"
                />
                <div className="text-xs leading-relaxed">
                  <span className="font-semibold text-[var(--ink)] block">
                    Açılışta Zorunlu Otomatik Güncelle
                  </span>
                  <span className="text-[var(--muted)]">
                    Program açılır açılmaz bu adresten güncel kanalları otomatik indirir.
                  </span>
                </div>
              </label>

              {lastUpdatedAt && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--accent)]">
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span className="font-mono-nums">Son güncelleme: {lastUpdatedAt}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onResetDefault();
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)] hover:bg-white/5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Varsayılan Liste</span>
                </button>

                <button
                  type="submit"
                  disabled={!inputUrl.trim()}
                  className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-bold hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors"
                >
                  Kaydet ve Güncelle
                </button>
              </div>
            </form>
          )}

          {tab === 'bulk' && (
            <form onSubmit={handleSubmitBulk} className="space-y-3">
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                GitHub üzerindeki <span className="text-[var(--ink)] font-semibold">.json</span> veya{' '}
                <span className="text-[var(--ink)] font-semibold">.m3u</span> dosyalarını alt alta yapıştırarak ek liste olarak programa gömün. Açılışta ve arka planda otomatik güncellenir.
              </p>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1">
                  Liste Adı (İsteğe bağlı)
                </label>
                <input
                  type="text"
                  value={bulkName}
                  onChange={(e) => setBulkName(e.target.value)}
                  placeholder="Örn: GitHub Spor JSON veya Ek Liste"
                  className="w-full rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--muted)] mb-1">
                  GitHub JSON / M3U Bağlantıları (Her satıra 1 link)
                </label>
                <textarea
                  rows={4}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={
                    'https://github.com/kullanici/repo/blob/main/spor.json\nhttps://raw.githubusercontent.com/kullanici/repo/main/ek-liste.m3u'
                  }
                  className="w-full rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-xs font-mono-nums text-[var(--ink)] placeholder-[var(--muted)]/55 focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              {bulkError && (
                <div className="text-xs font-medium text-[var(--live)]">{bulkError}</div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <a
                  href="/api/export/sample-list.json"
                  download="ornek-github-liste.json"
                  className="text-xs font-semibold text-[var(--accent)] hover:underline"
                >
                  Örnek JSON İndir ↗
                </a>
                <button
                  type="submit"
                  disabled={bulkLoading || !bulkText.trim()}
                  className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] disabled:opacity-40"
                >
                  {bulkLoading ? 'Çekiliyor...' : 'Toplu Ekle ve Güncelle'}
                </button>
              </div>
            </form>
          )}

          {tab === 'file' && (
            <div className="space-y-4">
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Cihazınızda kayıtlı olan <span className="text-[var(--ink)] font-semibold">.json</span>,{' '}
                <span className="text-[var(--ink)] font-semibold">.m3u</span> veya{' '}
                <span className="text-[var(--ink)] font-semibold">.m3u8</span> dosyasını doğrudan yükleyin.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".m3u,.m3u8,.json,.txt"
                onChange={handleLocalFileChange}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-6 px-4 rounded-xl border border-dashed border-[var(--accent)]/60 bg-[var(--bg)] hover:bg-[var(--surface-elevated)] flex flex-col items-center justify-center gap-2 transition-colors"
              >
                <FileUp className="w-7 h-7 text-[var(--accent)]" />
                <span className="text-sm font-bold text-[var(--ink)]">
                  Cihazdan JSON / M3U Dosyası Seç
                </span>
                <span className="text-xs text-[var(--muted)]">
                  GitHub JSON ve M3U formatları otomatik algılanır
                </span>
              </button>

              {fileError && (
                <div className="text-xs font-medium text-[var(--live)]">{fileError}</div>
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

              {xtreamError && (
                <div className="text-xs font-medium text-[var(--live)]">
                  {xtreamError}
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={xtreamLoading}
                  className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {xtreamLoading ? 'Bağlanıyor...' : 'Xtream Kanallarını Yükle'}
                </button>
              </div>
            </form>
          )}

          {tab === 'transfer' && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Mi Box TV veya televizyon kumandasıyla uzun M3U/JSON adreslerini tek tek yazmak yerine aşağıdaki doğrudan bağlantıyı kopyalayıp TV tarayıcısında açabilirsiniz:
              </p>

              <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] p-3 text-xs font-mono-nums text-[var(--ink)] break-all">
                {transferUrl}
              </div>

              <button
                type="button"
                onClick={handleCopyTransfer}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)]"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Bağlantı Kopyalandı</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>TV Aktarım Bağlantısını Kopyala</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
