import { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clock,
  CloudDownload,
  Copy,
  Download,
  ExternalLink,
  EyeOff,
  FileArchive,
  FileJson,
  FileUp,
  Gamepad2,
  Gauge,
  GitBranch,
  ImagePlus,
  Layers,
  Monitor,
  Palette,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  Zap,
} from 'lucide-react';
import {
  HIDEABLE_CATEGORIES,
  type AppSettings,
  type AppTheme,
  type AspectMode,
  type BufferPreset,
  type CategoryName,
  type ExternalListSource,
  type PlayerControlsSize,
  type RadioEffectIntensity,
  type RadioEffectMode,
} from '../types/channel';
import { getHlsProfileSummary } from '../utils/hlsConfig';
import { normalizeInputUrl } from '../utils/m3uParser';
import { APP_VERSION, compareSemver, GITHUB_REPO } from '../utils/appMeta';
import {
  clearErrorLogs,
  loadErrorLogs,
  type AppErrorEntry,
} from '../utils/errorLogger';
import { PWAInstallButton } from './PWAInstallButton';

interface AiDiscoverResponse {
  count: number;
  summary: string;
  webSources?: Array<{ title: string; uri: string }>;
  publishedUrl?: string;
}

interface SettingsTabProps {
  settings: AppSettings;
  savedUrl: string;
  mandatoryAutoUpdate: boolean;
  lastUpdatedAt: string | null;
  externalSources: ExternalListSource[];
  isSyncingExternal: boolean;
  isAiDiscovering: boolean;
  sleepMinutes: number | null;
  isUpdating: boolean;
  isLoadingEpg: boolean;
  epgChannelCount: number;
  favoriteCount: number;
  totalChannelsCount: number;
  onlineRadiosCount: number;
  blockedAdultCount?: number;
  trackedPerfCount?: number;
  channelsWithLogoCount?: number;
  isResolvingLogos?: boolean;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
  onSaveAndUpdateUrl: (url: string, mandatory: boolean) => void;
  onAddBulkExternalSources: (rawUrlsText: string, customName?: string) => Promise<void>;
  onAiDiscoverLists: (topic?: string) => Promise<AiDiscoverResponse>;
  onToggleExternalSource: (sourceId: string) => void;
  onRemoveExternalSource: (sourceId: string) => void;
  onSyncExternalSources: (targetSourceId?: string) => Promise<void>;
  onResetExternalPresets: () => void;
  onImportLocalExtraFile: (content: string, filename: string) => void;
  onOpenSourcesModal: () => void;
  onResetDefaultPlaylist: () => void;
  onRefreshEpg: (customEpgUrl?: string) => void;
  onSetSleepMinutes: (minutes: number | null) => void;
  onClearFavorites: () => void;
  onResetPerformanceStats?: () => void;
  onAutoFindLogos?: () => void;
}

const THEME_OPTIONS: Array<{ value: AppTheme; label: string; swatch: string }> = [
  { value: 'modern', label: 'Modern (Kehribar)', swatch: '#ffad55' },
  { value: 'klasik', label: 'Klasik (Mavi)', swatch: '#00e5ff' },
  { value: 'sinema', label: 'Sinema (Kızıl)', swatch: '#f43f5e' },
];

const ASPECT_OPTIONS: Array<{ value: AspectMode; label: string }> = [
  { value: 'fit', label: 'Sığdır' },
  { value: 'fill', label: 'Doldur' },
  { value: 'zoom', label: 'Yakınlaştır' },
];

const BUFFER_OPTIONS: Array<{ value: BufferPreset; label: string; desc: string }> = [
  { value: 'fast', label: 'Hızlı Açılış', desc: '14sn' },
  { value: 'balanced', label: 'Akıllı Tampon', desc: '24-36sn' },
  { value: 'ultra', label: 'Maks. Koruma', desc: '45-90sn' },
];

const REFRESH_OPTIONS = [
  { value: 0, label: 'Kapalı' },
  { value: 15, label: '15 dk' },
  { value: 30, label: '30 dk' },
  { value: 60, label: '60 dk' },
];

const SLEEP_OPTIONS = [
  { value: null, label: 'Kapalı' },
  { value: 15, label: '15 dk' },
  { value: 30, label: '30 dk' },
  { value: 45, label: '45 dk' },
  { value: 60, label: '60 dk' },
  { value: 90, label: '90 dk' },
];

const CONTROL_SIZE_OPTIONS: Array<{ value: PlayerControlsSize; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Büyük (Önerilen)' },
  { value: 'xlarge', label: 'Dev (TV / Kumanda)' },
];

const RADIO_EFFECT_OPTIONS: Array<{ value: RadioEffectMode; label: string }> = [
  { value: 'aurora', label: 'Aurora Dalgaları' },
  { value: 'equalizer', label: 'Tam Ekolayzer' },
  { value: 'pulse', label: 'Nabız Halkaları' },
  { value: 'cosmic', label: 'Kozmik Parıltı' },
  { value: 'off', label: 'Kapalı' },
];

const RADIO_INTENSITY_OPTIONS: Array<{ value: RadioEffectIntensity; label: string }> = [
  { value: 'calm', label: 'Sakin' },
  { value: 'medium', label: 'Orta' },
  { value: 'vivid', label: 'Canlı' },
];

const SAMPLE_JSON_SNIPPET = `{
  "name": "Özel Spor & TV Listem",
  "channels": [
    {
      "name": "TRT SPOR",
      "group": "Spor",
      "logo": "",
      "url": "https://tv-trtspor1.medya.trt.com.tr/master.m3u8"
    }
  ]
}`;

export function SettingsTab({
  settings,
  savedUrl,
  mandatoryAutoUpdate,
  lastUpdatedAt,
  externalSources,
  isSyncingExternal,
  isAiDiscovering,
  sleepMinutes,
  isUpdating,
  isLoadingEpg,
  epgChannelCount,
  favoriteCount,
  totalChannelsCount,
  onlineRadiosCount,
  blockedAdultCount = 0,
  trackedPerfCount = 0,
  channelsWithLogoCount = 0,
  isResolvingLogos = false,
  onUpdateSettings,
  onSaveAndUpdateUrl,
  onAddBulkExternalSources,
  onAiDiscoverLists,
  onToggleExternalSource,
  onRemoveExternalSource,
  onSyncExternalSources,
  onResetExternalPresets,
  onImportLocalExtraFile,
  onOpenSourcesModal,
  onResetDefaultPlaylist,
  onRefreshEpg,
  onSetSleepMinutes,
  onClearFavorites,
  onResetPerformanceStats,
  onAutoFindLogos,
}: SettingsTabProps) {
  const [urlInput, setUrlInput] = useState(savedUrl);
  const [mandatory, setMandatory] = useState(mandatoryAutoUpdate);
  const [epgUrlInput, setEpgUrlInput] = useState(settings.epgUrl);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const [bulkName, setBulkName] = useState('');
  const [bulkUrlsText, setBulkUrlsText] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [aiTopicInput, setAiTopicInput] = useState('');
  const [aiStatusNote, setAiStatusNote] = useState<string | null>(null);
  const [aiErrorNote, setAiErrorNote] = useState<string | null>(null);
  const [aiWebSources, setAiWebSources] = useState<Array<{ title: string; uri: string }>>([]);
  const [copiedSample, setCopiedSample] = useState(false);
  const [radioBgInput, setRadioBgInput] = useState(settings.radioBackgroundImage);
  const extraFileRef = useRef<HTMLInputElement | null>(null);
  const radioBgFileRef = useRef<HTMLInputElement | null>(null);

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    status: 'latest' | 'available' | 'error';
    latestVersion?: string;
    notes?: string;
    apkUrl?: string;
    releaseUrl?: string;
    message?: string;
  } | null>(null);
  const [errorLogs, setErrorLogs] = useState<AppErrorEntry[]>(loadErrorLogs);

  const handleCheckGithubUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        { headers: { Accept: 'application/vnd.github+json' } }
      );
      if (!res.ok) {
        setUpdateInfo({
          status: 'error',
          message:
            res.status === 404
              ? 'GitHub üzerinde henüz yayınlanmış bir APK Release bulunmuyor. Mevcut sürüm aktif.'
              : `Güncelleme sunucusu yanıt vermedi (HTTP ${res.status}).`,
        });
        return;
      }
      const data = (await res.json()) as {
        tag_name?: string;
        body?: string;
        html_url?: string;
        assets?: Array<{ name?: string; browser_download_url?: string }>;
      };
      const tag = (data.tag_name || APP_VERSION).replace(/^v/i, '');
      const apkAsset = (data.assets || []).find((a) =>
        a.name?.toLowerCase().endsWith('.apk')
      );
      const isNewer = compareSemver(tag, APP_VERSION) > 0;
      setUpdateInfo({
        status: isNewer ? 'available' : 'latest',
        latestVersion: tag,
        notes: data.body?.slice(0, 280),
        apkUrl: apkAsset?.browser_download_url,
        releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
      });
    } catch {
      setUpdateInfo({
        status: 'error',
        message: 'İnternet bağlantısı veya GitHub API erişimi yok; uygulama çalışmaya devam ediyor.',
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    setUrlInput(savedUrl);
    setMandatory(mandatoryAutoUpdate);
  }, [savedUrl, mandatoryAutoUpdate]);

  useEffect(() => {
    setEpgUrlInput(settings.epgUrl);
  }, [settings.epgUrl]);

  useEffect(() => {
    setRadioBgInput(settings.radioBackgroundImage);
  }, [settings.radioBackgroundImage]);

  const handleSaveUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeInputUrl(urlInput);
    if (!normalized) return;
    onSaveAndUpdateUrl(normalized, mandatory);
    setSavedFeedback(true);
    window.setTimeout(() => setSavedFeedback(false), 2000);
  };

  const handleBulkAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkError(null);
    if (!bulkUrlsText.trim()) {
      setBulkError('En az bir GitHub JSON veya M3U adresi girin.');
      return;
    }
    try {
      await onAddBulkExternalSources(bulkUrlsText, bulkName.trim() || undefined);
      setBulkUrlsText('');
      setBulkName('');
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Listeler eklenemedi.');
    }
  };

  const handleLocalExtraFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setBulkError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      onImportLocalExtraFile(content, file.name);
    } catch {
      setBulkError('Dosya okunamadı.');
    } finally {
      e.target.value = '';
    }
  };

  const handleCopySampleJson = async () => {
    try {
      await navigator.clipboard.writeText(SAMPLE_JSON_SNIPPET);
      setCopiedSample(true);
      window.setTimeout(() => setCopiedSample(false), 2000);
    } catch {
      // ignore
    }
  };

  const toggleHiddenCategory = (cat: CategoryName) => {
    const exists = settings.hiddenCategories.includes(cat);
    const next = exists
      ? settings.hiddenCategories.filter((c) => c !== cat)
      : [...settings.hiddenCategories, cat];
    onUpdateSettings({ hiddenCategories: next });
  };

  const enabledExternalCount = externalSources.filter((s) => s.enabled).length;
  const hlsSummary = getHlsProfileSummary({
    acceleratedPlaybackMode: settings.acceleratedPlaybackMode,
    bufferPreset: settings.bufferPreset,
    lowRamMode: settings.lowRamMode,
    isMultiScreen: false,
  });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto touch-scroll-y px-3 py-3 space-y-3 pb-6">
      {/* Hazırlayan Attribution Card */}
      <div className="rounded-2xl bg-[var(--surface-elevated)] border border-[var(--border-strong)] p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent)]/15 border border-[var(--accent)]/60 flex items-center justify-center shrink-0">
            <UserCheck className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
              Hazırlayan
            </div>
            <div className="text-sm font-extrabold text-[var(--ink)] truncate">
              Mehmet Cengiz Akdağ
            </div>
          </div>
        </div>
        <span className="font-mono-nums text-[11px] font-bold text-[var(--accent)] shrink-0">
          v{APP_VERSION}
        </span>
      </div>

      {/* Section 0.5: Sürüm Kontrolü (GitHub) & PWA Kurulumu */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <CloudDownload className="w-4 h-4" />
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Sürüm &amp; Güncelleme Kontrolü
            </h2>
          </div>
          <span className="font-mono-nums text-[10px] font-bold px-2 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)]">
            Sürüm {APP_VERSION}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={checkingUpdate}
            onClick={() => void handleCheckGithubUpdate()}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[var(--bg)] border border-[var(--accent)]/60 text-[var(--accent)] text-xs font-bold hover:bg-[var(--surface-elevated)] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
            <span>{checkingUpdate ? 'GitHub Kontrol Ediliyor...' : 'GitHub Üzerinden Güncelleme Kontrol Et'}</span>
          </button>

          <PWAInstallButton />
        </div>

        {updateInfo && (
          <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] p-2.5 text-[11px] space-y-1.5">
            {updateInfo.status === 'latest' && (
              <div className="text-[var(--accent)] font-bold">
                Uygulamanız güncel (v{updateInfo.latestVersion}). Favorileriniz ve ayarlarınız korunuyor.
              </div>
            )}
            {updateInfo.status === 'available' && (
              <div className="space-y-1.5">
                <div className="text-[var(--accent)] font-extrabold">
                  Yeni Sürüm Hazır: v{updateInfo.latestVersion}
                </div>
                {updateInfo.notes && (
                  <p className="text-[var(--muted)] whitespace-pre-line leading-snug">
                    {updateInfo.notes}
                  </p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  {updateInfo.apkUrl && (
                    <a
                      href={updateInfo.apkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>APK İndir (v{updateInfo.latestVersion})</span>
                    </a>
                  )}
                  {updateInfo.releaseUrl && (
                    <a
                      href={updateInfo.releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] text-xs font-semibold"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Sürüm Notu</span>
                    </a>
                  )}
                </div>
              </div>
            )}
            {updateInfo.status === 'error' && (
              <div className="text-[var(--muted)]">{updateInfo.message}</div>
            )}
          </div>
        )}
      </div>

      {/* Section 0.6: Otomatik Kanal & Radyo Logosu Bulucu */}
      {onAutoFindLogos && (
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[var(--accent)]">
              <ImagePlus className="w-4 h-4" />
              <h2 className="text-xs font-bold uppercase tracking-wider">
                Otomatik Kanal Logosu Bulucu
              </h2>
            </div>
            <span className="font-mono-nums text-[10px] font-bold px-2 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--accent)]">
              {channelsWithLogoCount}/{totalChannelsCount} Logolu
            </span>
          </div>
          <p className="text-[11px] text-[var(--muted)] leading-relaxed">
            Logosuz veya kırık logolu TV ve radyo kanallarına IPTV-org, EPG ve resmi kaynaklardan otomatik olarak logo bulur ve önbelleğe ekler.
          </p>
          <button
            type="button"
            disabled={isResolvingLogos || totalChannelsCount === 0}
            onClick={onAutoFindLogos}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isResolvingLogos ? 'animate-spin' : ''}`} />
            <span>
              {isResolvingLogos
                ? 'Kanallara Otomatik Logo Bulunuyor...'
                : 'Eksik Logoları Otomatik Bul & Ekle'}
            </span>
          </button>
        </div>
      )}

      {/* Section 1: Görünüm ve Tema Seçimi */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-2.5">
        <div className="flex items-center gap-2 text-[var(--accent)]">
          <Palette className="w-4 h-4" />
          <h2 className="text-xs font-bold uppercase tracking-wider">
            Tema Seçimi
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {THEME_OPTIONS.map((opt) => {
            const active = settings.theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onUpdateSettings({ theme: opt.value })}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-[11px] font-bold transition-colors ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'bg-[var(--bg)] text-[var(--ink)] border border-[var(--border)] hover:border-[var(--accent)]/60'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: opt.swatch }}
                />
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 2: FuTV Pro Tarzı Toplu Liste Ekle (Web + GitHub JSON / M3U Ek Listeler) */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--accent)] min-w-0">
            <GitBranch className="w-4 h-4 shrink-0" />
            <h2 className="text-xs font-bold uppercase tracking-wider truncate">
              Toplu Liste Ekle (Web / GitHub / JSON)
            </h2>
          </div>
          <span className="font-mono-nums text-[10px] font-bold px-2 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--accent)] shrink-0">
            {enabledExternalCount}/{externalSources.length} Aktif
          </span>
        </div>

        <p className="text-[11px] text-[var(--muted)] leading-relaxed">
          GitHub ve tüm web kaynaklarındaki <span className="text-[var(--ink)] font-semibold">.json</span> veya{' '}
          <span className="text-[var(--ink)] font-semibold">.m3u</span> dosyalarını toplu olarak ekleyin. Seçili listeler program açılışında ve arka planda daima güncellenip ana listeye birleştirilir.
        </p>

        {/* Gömülü Yapay Zeka (AI) Tüm Web + GitHub M3U Tarayıcı */}
        <div className="rounded-xl bg-[var(--bg)] border border-[var(--accent)]/45 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[var(--accent)] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Tüm Web &amp; GitHub M3U Bul, Ekle ve Yayınla</span>
            </span>
          </div>
          <label className="flex items-center justify-between gap-2 rounded-lg p-1 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
            <span className="text-[11px] text-[var(--muted)]">
              Açılışta AI tüm web&apos;den yeni M3U listesi arasın
            </span>
            <input
              type="checkbox"
              checked={settings.aiAutoDiscoverGithub}
              onChange={(e) =>
                onUpdateSettings({ aiAutoDiscoverGithub: e.target.checked })
              }
              className="h-4 w-4 accent-[var(--accent)] shrink-0"
            />
          </label>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={aiTopicInput}
              onChange={(e) => setAiTopicInput(e.target.value)}
              placeholder="İsteğe bağlı: örn. Türkçe spor, sinema, Kürtçe..."
              className="flex-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-2.5 py-1.5 text-[11px] text-[var(--ink)] placeholder-[var(--muted)]/55 focus:border-[var(--accent)]"
            />
            <button
              type="button"
              disabled={isAiDiscovering}
              onClick={async () => {
                setAiErrorNote(null);
                setAiStatusNote(null);
                setAiWebSources([]);
                try {
                  const res = await onAiDiscoverLists(aiTopicInput.trim() || undefined);
                  setAiStatusNote(res.summary);
                  if (Array.isArray(res.webSources)) {
                    setAiWebSources(res.webSources.slice(0, 4));
                  }
                } catch (err) {
                  setAiErrorNote(
                    err instanceof Error ? err.message : 'AI web taraması başarısız.'
                  );
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-[11px] font-bold hover:bg-[var(--accent-hover)] disabled:opacity-45 shrink-0"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isAiDiscovering ? 'animate-spin' : ''}`} />
              <span>{isAiDiscovering ? 'Arıyor...' : 'Webde Bul & Yayınla'}</span>
            </button>
          </div>
          {aiErrorNote && (
            <div className="text-[11px] font-medium text-[var(--live)]">{aiErrorNote}</div>
          )}
          {aiStatusNote && (
            <div className="text-[11px] font-medium text-[var(--accent)] space-y-1">
              <div>{aiStatusNote}</div>
              {aiWebSources.length > 0 && (
                <div className="text-[10px] text-[var(--muted)] space-y-0.5 pt-1 border-t border-white/10">
                  {aiWebSources.map((src) => (
                    <a
                      key={src.uri}
                      href={src.uri}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-[var(--accent)] hover:underline"
                    >
                      {src.title || src.uri}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Global Auto-Sync Switch + Sync All Button */}
        <div className="flex items-center gap-2">
          <label className="flex-1 flex items-center justify-between gap-2 rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
            <span className="text-[11px] font-semibold text-[var(--ink)]">
              Ek Listeleri Daima Güncelle
            </span>
            <input
              type="checkbox"
              checked={settings.autoSyncExternalLists}
              onChange={(e) =>
                onUpdateSettings({ autoSyncExternalLists: e.target.checked })
              }
              className="h-4 w-4 accent-[var(--accent)] shrink-0"
            />
          </label>
          <button
            type="button"
            disabled={isSyncingExternal || enabledExternalCount === 0}
            onClick={() => void onSyncExternalSources()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-[11px] font-bold hover:bg-[var(--accent-hover)] disabled:opacity-40 shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isSyncingExternal ? 'animate-spin' : ''}`}
            />
            <span>Tümünü Çek</span>
          </button>
        </div>

        {/* Registered External Sources List */}
        <div className="space-y-1.5">
          {externalSources.map((src) => (
            <div
              key={src.id}
              className={`rounded-xl border px-2.5 py-2 transition-colors ${
                src.enabled
                  ? 'bg-[var(--bg)] border-[var(--border-strong)]/60'
                  : 'bg-[var(--bg)]/60 border-[var(--border)] opacity-70'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer rounded-lg p-0.5 focus-within:ring-2 focus-within:ring-[var(--accent)]">
                  <input
                    type="checkbox"
                    checked={src.enabled}
                    onChange={() => onToggleExternalSource(src.id)}
                    className="h-3.5 w-3.5 accent-[var(--accent)] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-[var(--ink)] truncate">
                        {src.name}
                      </span>
                      <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-[var(--surface-elevated)] text-[var(--accent)] shrink-0">
                        {src.format === 'json' || src.url.toLowerCase().endsWith('.json')
                          ? 'JSON'
                          : 'M3U'}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono-nums text-[var(--muted)] truncate">
                      {src.url}
                    </div>
                  </div>
                </label>

                <div className="flex items-center gap-1 shrink-0">
                  {typeof src.channelCount === 'number' && (
                    <span className="font-mono-nums text-[10px] font-bold text-[var(--accent)] px-1.5">
                      {src.channelCount}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={isSyncingExternal || !src.enabled}
                    onClick={() => void onSyncExternalSources(src.id)}
                    title="Bu listeyi güncelle"
                    className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--accent)] hover:bg-white/5 disabled:opacity-40"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isSyncingExternal ? 'animate-spin' : ''}`}
                    />
                  </button>
                  {!src.isBuiltinPreset && (
                    <button
                      type="button"
                      onClick={() => onRemoveExternalSource(src.id)}
                      title="Listeyi sil"
                      className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--live)] hover:bg-white/5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {(src.lastUpdatedAt || src.lastError) && (
                <div className="mt-1 pl-5 flex items-center justify-between text-[10px]">
                  {src.lastError ? (
                    <span className="text-[var(--live)] truncate">{src.lastError}</span>
                  ) : (
                    <span className="font-mono-nums text-[var(--muted)]">
                      Son güncelleme: {src.lastUpdatedAt}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Bulk GitHub JSON / M3U Input Form */}
        <form
          onSubmit={handleBulkAdd}
          className="rounded-xl bg-[var(--bg)] border border-[var(--border)] p-2.5 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[var(--ink)] flex items-center gap-1.5">
              <FileJson className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>Yeni GitHub JSON / M3U Bağlantısı Ekle (Toplu)</span>
            </span>
            <button
              type="button"
              onClick={onResetExternalPresets}
              className="text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--accent)]"
            >
              Varsayılan Ek Listeleri Yenile
            </button>
          </div>

          <input
            type="text"
            value={bulkName}
            onChange={(e) => setBulkName(e.target.value)}
            placeholder="Liste Başlığı (İsteğe bağlı, örn: Spor JSON)"
            className="w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--ink)] placeholder-[var(--muted)]/55 focus:outline-none focus:border-[var(--accent)]"
          />

          <textarea
            rows={3}
            value={bulkUrlsText}
            onChange={(e) => setBulkUrlsText(e.target.value)}
            placeholder={
              'Birden fazla GitHub .json veya .m3u linkini alt alta yapıştırın:\nhttps://raw.githubusercontent.com/cengiz718/Cengiz-tv/main/spor.json'
            }
            className="w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-mono-nums text-[var(--ink)] placeholder-[var(--muted)]/55 focus:outline-none focus:border-[var(--accent)]"
          />

          {bulkError && (
            <div className="text-[11px] font-medium text-[var(--live)]">{bulkError}</div>
          )}

          <input
            ref={extraFileRef}
            type="file"
            accept=".json,.m3u,.m3u8,.txt"
            onChange={handleLocalExtraFile}
            className="hidden"
          />

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isSyncingExternal || !bulkUrlsText.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Toplu Ekle ve Çek</span>
            </button>

            <button
              type="button"
              onClick={() => extraFileRef.current?.click()}
              className="flex items-center gap-1.5 py-2 px-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)]"
            >
              <FileUp className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>JSON/M3U Dosya</span>
            </button>
          </div>

          <div className="pt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--muted)]">
            <a
              href="/api/export/sample-list.json"
              download="ornek-github-liste.json"
              className="text-[var(--accent)] font-semibold hover:underline"
            >
              Örnek GitHub JSON İndir
            </a>
            <button
              type="button"
              onClick={handleCopySampleJson}
              className="flex items-center gap-1 text-[var(--ink)] hover:text-[var(--accent)] font-semibold"
            >
              {copiedSample ? (
                <>
                  <Check className="w-3 h-3 text-[var(--accent)]" />
                  <span>JSON Kopyalandı</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>JSON Şablonu Kopyala</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Section 3: Ana M3U / Xtream Kaynağı */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <CloudDownload className="w-4 h-4" />
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Ana Liste &amp; Xtream
            </h2>
          </div>
          <button
            type="button"
            onClick={onOpenSourcesModal}
            className="text-[11px] font-bold text-[var(--accent)] hover:underline"
          >
            Xtream / Dosya / Aktar ↗
          </button>
        </div>

        <form onSubmit={handleSaveUrl} className="space-y-2.5">
          <div>
            <label
              htmlFor="settings-m3u-url"
              className="block text-[11px] font-medium text-[var(--muted)] mb-1"
            >
              Zorunlu M3U / JSON Güncelleme Adresi
            </label>
            <input
              id="settings-m3u-url"
              type="text"
              inputMode="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://.../playlist.m3u8"
              className="w-full rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--muted)]/60 focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--ink)]">
                Açılışta Zorunlu Güncelle
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                Program açılır açılmaz bu adresten listeyi indirir
              </div>
            </div>
            <input
              type="checkbox"
              checked={mandatory}
              onChange={(e) => {
                const next = e.target.checked;
                setMandatory(next);
                const normalized = normalizeInputUrl(urlInput);
                if (normalized) {
                  onSaveAndUpdateUrl(normalized, next);
                }
              }}
              className="h-4 w-4 accent-[var(--accent)] shrink-0"
            />
          </label>

          <div>
            <div className="text-[11px] font-medium text-[var(--muted)] mb-1.5">
              Arka Plan Otomatik Yenileme Aralığı
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {REFRESH_OPTIONS.map((opt) => {
                const active = settings.autoRefreshMinutes === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({ autoRefreshMinutes: opt.value })
                    }
                    className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                        : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {lastUpdatedAt && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--accent)]">
              <RefreshCw className="w-3 h-3" />
              <span className="font-mono-nums">Son güncelleme: {lastUpdatedAt}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={!urlInput.trim() || isUpdating}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] disabled:opacity-40"
            >
              {savedFeedback ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Güncellendi</span>
                </>
              ) : (
                <>
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`}
                  />
                  <span>Kaydet ve Güncelle</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onResetDefaultPlaylist}
              title="Varsayılan Listeye Dön"
              className="p-2 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--accent)] hover:border-[var(--accent)]"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

      {/* Section 4: +18 Yetişkin Filtresi, Akıllı Gruplandırma & Kategori Gizleme */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <ShieldCheck className="w-4 h-4" />
            <h2 className="text-xs font-bold uppercase tracking-wider">
              İçerik Filtresi (+18) &amp; Akıllı Gruplandırma
            </h2>
          </div>
          {settings.hideAdultContent && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/40">
              +18 Kapalı
            </span>
          )}
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] border border-[var(--accent)]/45 px-3 py-2.5 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[var(--ink)]">
              Yetişkin İçerikleri Kapat (+18 Güvenli Mod)
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              +18, erotik ve yetişkin yayınlar TV, Film/Dizi ve Radyo listelerinden tamamen gizlenir
              {blockedAdultCount > 0 ? ` (${blockedAdultCount} içerik engellendi)` : ''}
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.hideAdultContent}
            onChange={(e) =>
              onUpdateSettings({ hideAdultContent: e.target.checked })
            }
            className="h-4 w-4 accent-[var(--accent)] shrink-0"
          />
        </label>

        <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--ink)]">
              <Layers className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>Akıllı Gruplandırma (Çoklu Tür Filtresi)</span>
            </span>
            {settings.smartGroupFilters.length > 0 && (
              <button
                type="button"
                onClick={() => onUpdateSettings({ smartGroupFilters: [] })}
                className="text-[10px] font-bold text-[var(--accent)] hover:underline"
              >
                Filtreyi Temizle
              </button>
            )}
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Sadece Spor, Haber veya Belgesel gibi belirlediğiniz türleri tek seferde listelemek için seçim yapın:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {HIDEABLE_CATEGORIES.map((cat) => {
              const selected = settings.smartGroupFilters.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    const next = selected
                      ? settings.smartGroupFilters.filter((c) => c !== cat)
                      : [...settings.smartGroupFilters, cat];
                    onUpdateSettings({ smartGroupFilters: next });
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                    selected
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                      : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
          <label className="flex items-center justify-between gap-3 pt-1 cursor-pointer rounded-lg p-1 focus-within:ring-2 focus-within:ring-[var(--accent)]">
            <span className="text-[11px] text-[var(--muted)]">
              Kanal listesinde tür başlıklarını gruplu göster
            </span>
            <input
              type="checkbox"
              checked={settings.groupChannelsByCategory}
              onChange={(e) =>
                onUpdateSettings({ groupChannelsByCategory: e.target.checked })
              }
              className="h-4 w-4 accent-[var(--accent)] shrink-0"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <EyeOff className="w-4 h-4" />
            <h3 className="text-[11px] font-bold uppercase tracking-wider">
              Kategori Gizleme
            </h3>
          </div>
          {settings.hiddenCategories.length > 0 && (
            <button
              type="button"
              onClick={() => onUpdateSettings({ hiddenCategories: [] })}
              className="text-[11px] font-semibold text-[var(--accent)] hover:underline"
            >
              Tümünü Göster
            </button>
          )}
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          İzlemediğiniz kategorileri sol menü ve kanal filtresinden gizleyin.
        </p>

        <div className="grid grid-cols-2 gap-1.5">
          {HIDEABLE_CATEGORIES.map((cat) => {
            const isHidden = settings.hiddenCategories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleHiddenCategory(cat)}
                className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-left text-[11px] font-semibold transition-colors ${
                  isHidden
                    ? 'bg-[var(--bg)] border-[var(--live)]/40 text-[var(--muted)] line-through'
                    : 'bg-[var(--bg)] border-[var(--border)] text-[var(--ink)] hover:border-[var(--accent)]/60'
                }`}
              >
                <span className="truncate">{cat}</span>
                <span className="text-[10px] shrink-0 font-bold">
                  {isHidden ? 'Gizli' : 'Açık'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 5: Online EPG (Yayın Akışı) Ayarları */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <CalendarClock className="w-4 h-4" />
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Online EPG (Yayın Akışı)
            </h2>
          </div>
          <span className="font-mono-nums text-[11px] font-semibold text-[var(--muted)]">
            {epgChannelCount > 0 ? `${epgChannelCount} kanal aktif` : 'Bekleniyor'}
          </span>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <div>
            <div className="text-xs font-semibold text-[var(--ink)]">
              Online EPG Göster
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              &quot;Şimdi ne var, sonra ne var?&quot; bilgisini gösterir
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.epgEnabled}
            onChange={(e) =>
              onUpdateSettings({ epgEnabled: e.target.checked })
            }
            className="h-4 w-4 accent-[var(--accent)] shrink-0"
          />
        </label>

        <div>
          <label
            htmlFor="settings-epg-url"
            className="block text-[11px] font-medium text-[var(--muted)] mb-1"
          >
            Özel XMLTV EPG Adresi (Boşsa Varsayılan Türkiye EPG)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="settings-epg-url"
              type="text"
              inputMode="url"
              value={epgUrlInput}
              onChange={(e) => setEpgUrlInput(e.target.value)}
              placeholder="https://.../epg.xml.gz"
              className="flex-1 rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--muted)]/60 focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              disabled={isLoadingEpg}
              onClick={() => {
                onUpdateSettings({ epgUrl: epgUrlInput.trim() });
                onRefreshEpg(epgUrlInput.trim());
              }}
              className="px-3 py-2 rounded-xl bg-[var(--bg)] border border-[var(--accent)]/60 text-[var(--accent)] text-xs font-bold hover:bg-[var(--surface-elevated)] disabled:opacity-50"
            >
              {isLoadingEpg ? '...' : 'Güncelle'}
            </button>
          </div>
        </div>
      </div>

      {/* Section 5.5: Oynatıcı İkon Boyutu & Radyo Arka Plan Efektleri */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-3">
        <div className="flex items-center gap-2 text-[var(--accent)]">
          <Sparkles className="w-4 h-4" />
          <h2 className="text-xs font-bold uppercase tracking-wider">
            İkon Boyutu &amp; Radyo Arka Plan Efektleri
          </h2>
        </div>

        <div>
          <div className="text-[11px] font-medium text-[var(--muted)] mb-1.5">
            Play / İleri-Geri / Tam Ekran İkon Boyutu
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {CONTROL_SIZE_OPTIONS.map((opt) => {
              const active = settings.playerControlsSize === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ playerControlsSize: opt.value })
                  }
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-[var(--muted)] mb-1.5">
            İleri / Geri Sarma Adımı
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[10, 15, 30].map((sec) => {
              const active = settings.playerSeekStepSeconds === sec;
              return (
                <button
                  key={sec}
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ playerSeekStepSeconds: sec })
                  }
                  className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  <span className="font-mono-nums">{sec}</span> Saniye
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <div>
            <div className="text-xs font-semibold text-[var(--ink)]">
              Yüksek Kontrastlı İkon Çerçeveleri
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              Butonları koyu çerçeveyle belirginleştirir (gündüz görünürlüğü)
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.playerHighContrastControls}
            onChange={(e) =>
              onUpdateSettings({ playerHighContrastControls: e.target.checked })
            }
            className="h-4 w-4 accent-[var(--accent)] shrink-0"
          />
        </label>

        <div>
          <div className="text-[11px] font-medium text-[var(--muted)] mb-1.5">
            Radyo Çalarken Arka Plan Efekti
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {RADIO_EFFECT_OPTIONS.map((opt) => {
              const active = settings.radioEffectMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ radioEffectMode: opt.value })
                  }
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-[var(--muted)] mb-1.5">
            Radyo Efekt Yoğunluğu
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {RADIO_INTENSITY_OPTIONS.map((opt) => {
              const active = settings.radioEffectIntensity === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ radioEffectIntensity: opt.value })
                  }
                  className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <span className="text-xs font-semibold text-[var(--ink)]">
            Radyo Logosunu Sahnede Göster
          </span>
          <input
            type="checkbox"
            checked={settings.radioShowLogoInStage}
            onChange={(e) =>
              onUpdateSettings({ radioShowLogoInStage: e.target.checked })
            }
            className="h-4 w-4 accent-[var(--accent)] shrink-0"
          />
        </label>

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-[var(--muted)]">
            Radyo Özel Arka Plan Fotoğrafı (İsteğe Bağlı)
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="url"
              value={radioBgInput.startsWith('data:') ? 'Yerel fotoğraf yüklendi' : radioBgInput}
              readOnly={radioBgInput.startsWith('data:')}
              onChange={(e) => setRadioBgInput(e.target.value)}
              placeholder="https://.../duvar-kagidi.jpg"
              className="flex-1 rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--ink)] placeholder-[var(--muted)]/55 focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ radioBackgroundImage: radioBgInput.trim() })
              }
              className="px-2.5 py-1.5 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-[11px] font-bold"
            >
              Uygula
            </button>
          </div>
          <input
            ref={radioBgFileRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result === 'string') {
                  setRadioBgInput(reader.result);
                  onUpdateSettings({ radioBackgroundImage: reader.result });
                }
              };
              reader.readAsDataURL(file);
              e.target.value = '';
            }}
            className="hidden"
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => radioBgFileRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[11px] font-semibold text-[var(--ink)] hover:border-[var(--accent)]"
            >
              <ImagePlus className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>Cihazdan Fotoğraf Seç</span>
            </button>
            {settings.radioBackgroundImage && (
              <button
                type="button"
                onClick={() => {
                  setRadioBgInput('');
                  onUpdateSettings({ radioBackgroundImage: '' });
                }}
                className="text-[11px] font-semibold text-[var(--live)] hover:underline"
              >
                Fotoğrafı Kaldır
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Section 6: Oynatıcı & Kaldığın Yerden Devam */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <Monitor className="w-4 h-4" />
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Oynatıcı ve Hafıza Ayarları
            </h2>
          </div>
          {settings.acceleratedPlaybackMode && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/40">
              HLS Hızlı Mod Aktif
            </span>
          )}
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] border border-[var(--accent)]/60 px-3 py-2.5 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)]/15 border border-[var(--accent)]/40 flex items-center justify-center shrink-0 mt-0.5">
              <Zap className="w-4 h-4 text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-[var(--accent)]">
                Hızlandırılmış Oynatma Modu (Anti-Donma · HLS)
              </div>
              <div className="text-[11px] text-[var(--muted)] leading-snug mt-0.5">
                Düşük internet hızlarında HLS önbellek, boşluk atlama ve uyarlamalı bit hızını (ABR) dinamik ayarlayarak donmayı en aza indirir.
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono-nums text-[10px] font-bold text-[var(--ink)]">
                <span className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">
                  Tampon: {hlsSummary.maxBufferLength}–{hlsSummary.maxMaxBufferLength} sn
                </span>
                <span className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">
                  ABR Başlangıç: {hlsSummary.abrDefaultKbps} kbps
                </span>
                <span className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">
                  {hlsSummary.fragLoadingMaxRetry}x Yeniden Deneme
                </span>
              </div>
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.acceleratedPlaybackMode}
            onChange={(e) =>
              onUpdateSettings({ acceleratedPlaybackMode: e.target.checked })
            }
            className="h-4 w-4 accent-[var(--accent)] shrink-0"
          />
        </label>

        {/* Performans Derecelendirme & Stabil Kanalları Başa Taşı */}
        <div className="rounded-xl bg-[var(--bg)] border border-[var(--border-strong)]/60 p-3 space-y-2">
          <label className="flex items-center justify-between gap-3 cursor-pointer rounded-lg p-0.5 focus-within:ring-2 focus-within:ring-[var(--accent)]">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent)]/15 border border-[var(--accent)]/40 flex items-center justify-center shrink-0 mt-0.5">
                <Gauge className="w-4 h-4 text-[var(--accent)]" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-extrabold text-[var(--ink)]">
                  Kanal Performans Derecelendirme &amp; Otomatik Sıralama
                </div>
                <div className="text-[11px] text-[var(--muted)] leading-snug mt-0.5">
                  Açılış hızını ve takılma oranını cihazınızda takip eder; en stabil çalışan kanalları otomatik olarak listenin en başına taşır.
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.performanceSortEnabled}
              onChange={(e) =>
                onUpdateSettings({ performanceSortEnabled: e.target.checked })
              }
              className="h-4 w-4 accent-[var(--accent)] shrink-0"
            />
          </label>
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border)]/60 text-[11px]">
            <span className="text-[var(--muted)]">
              Ölçülen kanal: <span className="font-mono-nums font-bold text-[var(--accent)]">{trackedPerfCount}</span>
            </span>
            {onResetPerformanceStats && (
              <button
                type="button"
                disabled={trackedPerfCount === 0}
                onClick={onResetPerformanceStats}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--live)] hover:border-[var(--live)]/50 disabled:opacity-40 text-[11px] font-semibold"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Skorları Sıfırla</span>
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-[var(--muted)] mb-1.5">
            Varsayılan Ekran Oranı
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {ASPECT_OPTIONS.map((opt) => {
              const active = settings.defaultAspectMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ defaultAspectMode: opt.value })
                  }
                  className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-[var(--muted)] mb-1">
            Yayın Tamponu / Yavaş İnternet Hızlandırma (Anti-Donma)
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {BUFFER_OPTIONS.map((opt) => {
              const active = settings.bufferPreset === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onUpdateSettings({ bufferPreset: opt.value })}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  <div>{opt.label}</div>
                  <div className="text-[9px] opacity-80 font-mono-nums">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-[var(--muted)] mb-1.5">
            Menüleri ve Liste Panelini Otomatik Kapatma Süresi
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { value: 5, label: '5 Saniye (Önerilen)' },
              { value: 10, label: '10 Saniye' },
              { value: 0, label: 'Kapalı' },
            ].map((opt) => {
              const active = settings.menuAutoCloseSeconds === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onUpdateSettings({ menuAutoCloseSeconds: opt.value })}
                  className={`py-1.5 px-1 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-[var(--muted)] mb-1.5">
            Tam Ekran Kontrollerini Gizleme Süresi
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[3, 5, 8].map((sec) => {
              const active = settings.hudHideSeconds === sec;
              return (
                <button
                  key={sec}
                  type="button"
                  onClick={() => onUpdateSettings({ hudHideSeconds: sec })}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)]'
                  }`}
                >
                  <span className="font-mono-nums">{sec}</span> Saniye
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <div>
            <div className="text-xs font-semibold text-[var(--ink)]">
              Kaldığın Yerden Devam Et
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              Açılışta son izlediğin kanal ve kategoriyi otomatik hatırlar
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.resumeLastChannel}
            onChange={(e) =>
              onUpdateSettings({ resumeLastChannel: e.target.checked })
            }
            className="h-4 w-4 accent-[var(--accent)] shrink-0"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Radio className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <div>
              <div className="text-xs font-semibold text-[var(--ink)]">
                Online Radyoları Ana Listeye Ekle
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                <span className="font-mono-nums">{onlineRadiosCount}</span> canlı radyo &quot;Radyo &amp; Müzik&quot; kategorisine eklenir
              </div>
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.mergeOnlineRadiosToChannels}
            onChange={(e) =>
              onUpdateSettings({
                mergeOnlineRadiosToChannels: e.target.checked,
              })
            }
            className="h-4 w-4 accent-[var(--accent)] shrink-0"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <div>
            <div className="text-xs font-semibold text-[var(--ink)]">
              Açılışta Yayını Otomatik Başlat
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              Program açıldığında son kanal veya TRT 1 HD otomatik açılır
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.autoPlayOnLaunch}
            onChange={(e) =>
              onUpdateSettings({ autoPlayOnLaunch: e.target.checked })
            }
            className="h-4 w-4 accent-[var(--accent)] shrink-0"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg)] border border-[var(--accent)]/40 px-3 py-2.5 cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent)]">
          <div>
            <div className="text-xs font-semibold text-[var(--accent)]">
              Düşük RAM &amp; Hızlı Açılış Modu (Mi Box Önerilen)
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              HLS bellek tamponunu sınırlar, açılışı hızlandırır ve düşük RAM cihazlarda akıcı çalışır
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.lowRamMode}
            onChange={(e) =>
              onUpdateSettings({ lowRamMode: e.target.checked })
            }
            className="h-4 w-4 accent-[var(--accent)] shrink-0"
          />
        </label>
      </div>

      {/* Section 7: Uyku Zamanlayıcısı */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <Clock className="w-4 h-4" />
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Uyku Zamanlayıcısı
            </h2>
          </div>
          {sleepMinutes !== null && (
            <span className="font-mono-nums text-[11px] font-bold text-[var(--accent)]">
              {sleepMinutes} dk kaldı
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {SLEEP_OPTIONS.map((opt) => {
            const active =
              opt.value === null
                ? sleepMinutes === null
                : sleepMinutes === opt.value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onSetSleepMinutes(opt.value)}
                className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 8: Mi Box TV Kumandası & Mobil Kısayollar */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-2">
        <div className="flex items-center gap-2 text-[var(--accent)]">
          <Gamepad2 className="w-4 h-4" />
          <h2 className="text-xs font-bold uppercase tracking-wider">
            Mi Box Kumanda &amp; Telefon Kontrolleri
          </h2>
        </div>
        <div className="text-[11px] text-[var(--muted)] space-y-1 leading-relaxed">
          <div>
            <span className="text-[var(--ink)] font-semibold">Tam Ekran Kanal Listesi:</span>{' '}
            Sol/Sağ Ok veya <span className="text-[var(--accent)] font-mono-nums">L</span> tuşu (Telefonda sağa kaydır)
          </div>
          <div>
            <span className="text-[var(--ink)] font-semibold">Kanal Değiştir:</span>{' '}
            Yukarı/Aşağı Ok veya Kanal +/- (Telefonda yukarı/aşağı kaydır)
          </div>
          <div>
            <span className="text-[var(--ink)] font-semibold">Oynat / Seç:</span>{' '}
            OK / Enter · <span className="text-[var(--ink)] font-semibold">Çıkış:</span> Geri / ESC
          </div>
        </div>
      </div>

      {/* Section 9: Dosya İndirme ve Tam Kaynak Paketi */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-2.5">
        <div className="flex items-center gap-2 text-[var(--accent)]">
          <Download className="w-4 h-4" />
          <h2 className="text-xs font-bold uppercase tracking-wider">
            Programın Tüm Dosyaları &amp; APK Kaynağı
          </h2>
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          Tüm kaynak kodları, özel simgeler, M3U listeleri, AI entegrasyonu ve GitHub Actions APK derleme dosyasını eksiksiz tek paket halinde indirin.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <a
            href="/api/export/source.zip"
            download="eymen-tv-radyo-tam-kaynak.zip"
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] transition-colors"
          >
            <FileArchive className="w-4 h-4" />
            <span>Tüm Dosyalar (.ZIP)</span>
          </a>
          <a
            href="/api/export/source.tar.gz"
            download="eymen-tv-radyo-kaynak.tar.gz"
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] text-xs font-bold hover:border-[var(--accent)] transition-colors"
          >
            <FileArchive className="w-4 h-4 text-[var(--accent)]" />
            <span>Kaynak (.tar.gz)</span>
          </a>
          <a
            href="/api/export/playlist.m3u8"
            download="playlist.m3u8"
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] text-xs font-bold hover:border-[var(--accent)] transition-colors"
          >
            <Download className="w-4 h-4 text-[var(--accent)]" />
            <span>playlist.m3u8</span>
          </a>
        </div>
      </div>

      {/* Section 10: Veri ve Favori Yönetimi */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 flex items-center justify-between gap-3">
        <div className="text-[11px] text-[var(--muted)]">
          <div>
            Toplam <span className="font-mono-nums text-[var(--ink)] font-semibold">{totalChannelsCount}</span> kanal ·{' '}
            <span className="font-mono-nums text-[var(--accent)] font-semibold">{onlineRadiosCount}</span> online radyo
          </div>
          <div>
            Kayıtlı favori: <span className="font-mono-nums text-[var(--ink)] font-semibold">{favoriteCount}</span>
          </div>
        </div>
        <button
          type="button"
          disabled={favoriteCount === 0}
          onClick={onClearFavorites}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--bg)] border border-[var(--live)]/40 text-[var(--live)] text-xs font-semibold hover:bg-[var(--live)]/10 disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Favorileri Sil</span>
        </button>
      </div>

      {/* Section 11: Yerel Hata Kayıtları (Kişisel Veri Toplanmaz) */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <AlertTriangle className="w-4 h-4" />
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Hata Günlüğü ({errorLogs.length})
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setErrorLogs(loadErrorLogs())}
              className="px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--ink)]"
            >
              Yenile
            </button>
            <button
              type="button"
              disabled={errorLogs.length === 0}
              onClick={() => {
                clearErrorLogs();
                setErrorLogs([]);
              }}
              className="px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--live)]/40 text-[10px] font-semibold text-[var(--live)] disabled:opacity-40"
            >
              Temizle
            </button>
          </div>
        </div>
        {errorLogs.length === 0 ? (
          <div className="text-[11px] text-[var(--muted)]">
            Kaydedilmiş sistem veya yayın hatası yok.
          </div>
        ) : (
          <div className="max-h-36 overflow-y-auto touch-scroll-y space-y-1.5 pr-1">
            {errorLogs.slice(0, 10).map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg bg-[var(--bg)] border border-[var(--border)] px-2.5 py-1.5 text-[10px]"
              >
                <div className="flex items-center justify-between gap-2 font-mono-nums text-[var(--muted)]">
                  <span className="uppercase font-bold text-[var(--accent)]">
                    {entry.source}
                  </span>
                  <span>{entry.timestamp}</span>
                </div>
                <div className="text-[var(--ink)] font-medium break-words mt-0.5">
                  {entry.message}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
