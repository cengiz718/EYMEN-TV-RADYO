export type MediaCategory = "tv" | "radio" | "movie" | "series";

export interface StreamSource {
  id: string;
  label: string;
  url: string;
  priority?: number;
}

export interface MediaItem {
  id: string;
  title: string;
  category: MediaCategory;
  group?: string;
  logo?: string;
  season?: number;
  episode?: number;
  sources: StreamSource[];
}

export interface CatalogConfig {
  tvJsonUrl?: string;
  tvM3uUrl?: string;
  radioJsonUrl?: string;
  movieJsonUrl?: string;
  seriesJsonUrl?: string;
  failoverTimeoutMs?: number;
}

export type PlayerStatusListener = (info: {
  item: MediaItem;
  source: StreamSource;
  sourceIndex: number;
  message: string;
  isError?: boolean;
}) => void;

interface HlsErrorData {
  fatal?: boolean;
  type?: string;
  details?: string;
}

interface HlsInstance {
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  startLoad: () => void;
  recoverMediaError: () => void;
  on: (event: string, cb: (_event: string, data: HlsErrorData) => void) => void;
  destroy: () => void;
}

interface HlsConstructor {
  isSupported: () => boolean;
  new (config?: Record<string, unknown>): HlsInstance;
  Events: {
    ERROR: string;
  };
  ErrorTypes?: {
    NETWORK_ERROR?: string;
    MEDIA_ERROR?: string;
  };
}

function getWindowHls(): HlsConstructor | undefined {
  return (window as unknown as { Hls?: HlsConstructor }).Hls;
}

function isValidMediaItem(item: unknown): item is MediaItem {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<MediaItem>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.sources) &&
    candidate.sources.some(
      (s) => s && typeof s.url === "string" && s.url.trim().length > 0
    )
  );
}

export function parseM3uToMediaItems(
  m3uText: string,
  category: MediaCategory = "tv"
): MediaItem[] {
  const lines = m3uText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const groupedMap = new Map<string, MediaItem>();
  let pendingMeta: { title: string; group: string; logo?: string } | null = null;

  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const commaIdx = line.lastIndexOf(",");
      const title =
        commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : "İsimsiz Yayın";

      pendingMeta = {
        title: title || "İsimsiz Yayın",
        group: groupMatch?.[1]?.trim() || "Genel",
        logo: logoMatch?.[1]?.trim() || undefined,
      };
    } else if (line.startsWith("#")) {
      // #EXTVLCOPT gibi ek etiketlerde pendingMeta korunur
      continue;
    } else if (pendingMeta && /^https?:\/\//i.test(line)) {
      const key = `${category}:${pendingMeta.title.toLowerCase()}`;
      const existing = groupedMap.get(key);

      if (existing) {
        const nextIdx = existing.sources.length + 1;
        existing.sources.push({
          id: `${existing.id}-src-${nextIdx}`,
          label: `Yedek Yayın ${nextIdx - 1}`,
          url: line,
          priority: nextIdx,
        });
      } else {
        const idBase = `${category}-${groupedMap.size + 1}`;
        groupedMap.set(key, {
          id: idBase,
          title: pendingMeta.title,
          category,
          group: pendingMeta.group,
          logo: pendingMeta.logo,
          sources: [
            {
              id: `${idBase}-src-1`,
              label: "Ana Yayın",
              url: line,
              priority: 1,
            },
          ],
        });
      }
      pendingMeta = null;
    }
  }

  return Array.from(groupedMap.values());
}

export class EymenStreamController {
  private mediaEl: HTMLVideoElement | HTMLAudioElement;
  private onStatus?: PlayerStatusListener;
  private timeoutMs: number;
  private failoverTimer: number | null = null;
  private failedTimestamps = new Map<string, number>();

  private activeItem: MediaItem | null = null;
  private activeSources: StreamSource[] = [];
  private activeSourceIndex = 0;
  private hlsInstance: HlsInstance | null = null;
  private sessionToken = 0;
  private hasStartedPlaying = false;
  private hlsMediaRecoveryAttempted = false;

  constructor(
    mediaElement: HTMLVideoElement | HTMLAudioElement,
    options?: { failoverTimeoutMs?: number; onStatus?: PlayerStatusListener }
  ) {
    this.mediaEl = mediaElement;
    this.timeoutMs = options?.failoverTimeoutMs ?? 5000;
    this.onStatus = options?.onStatus;
    this.bindMediaEvents();
  }

  private clearTimer(): void {
    if (this.failoverTimer !== null) {
      window.clearTimeout(this.failoverTimer);
      this.failoverTimer = null;
    }
  }

  private destroyHls(): void {
    if (this.hlsInstance) {
      try {
        this.hlsInstance.destroy();
      } catch {
        // Temizleme hatası yoksayılır
      }
      this.hlsInstance = null;
    }
    this.hlsMediaRecoveryAttempted = false;
  }

  private isUrlRecentlyFailed(url: string): boolean {
    const ts = this.failedTimestamps.get(url);
    if (!ts) return false;
    if (Date.now() - ts > 60_000) {
      this.failedTimestamps.delete(url);
      return false;
    }
    return true;
  }

  private emitStatus(message: string, isError = false): void {
    if (!this.activeItem || !this.onStatus) return;
    const source = this.activeSources[this.activeSourceIndex];
    if (!source) return;

    this.onStatus({
      item: this.activeItem,
      source,
      sourceIndex: this.activeSourceIndex,
      message,
      isError,
    });
  }

  private bindMediaEvents(): void {
    this.mediaEl.addEventListener("playing", () => {
      this.clearTimer();
      this.hasStartedPlaying = true;
      const src = this.activeSources[this.activeSourceIndex];
      this.emitStatus(`Yayında • ${src?.label ?? "Kaynak"}`, false);
    });

    this.mediaEl.addEventListener("error", () => {
      const token = this.sessionToken;
      if (!this.activeItem || token !== this.sessionToken) return;
      this.switchToNextSource("Yayın hatası oluştu", token);
    });

    this.mediaEl.addEventListener("stalled", () => {
      const token = this.sessionToken;
      if (!this.activeItem || token !== this.sessionToken) return;
      this.scheduleFailover("Bağlantı yavaşladı", token);
    });

    this.mediaEl.addEventListener("ended", () => {
      const token = this.sessionToken;
      if (!this.activeItem || token !== this.sessionToken) return;
      if (this.activeSources.length > 1) {
        this.switchToNextSource("Yayın kesildi, yedek deneniyor", token);
      }
    });
  }

  private scheduleFailover(reason: string, token = this.sessionToken): void {
    this.clearTimer();
    this.failoverTimer = window.setTimeout(() => {
      if (token !== this.sessionToken || !this.activeItem) return;
      if (!this.hasStartedPlaying || this.mediaEl.readyState < 2) {
        this.switchToNextSource(reason, token);
      }
    }, this.timeoutMs);
  }

  public playItem(item: MediaItem, startIndex = 0): void {
    const validSources = (item.sources || []).filter(
      (s) => typeof s.url === "string" && s.url.trim().length > 0
    );
    if (validSources.length === 0) return;

    this.sessionToken += 1;
    const currentToken = this.sessionToken;

    this.activeItem = item;
    this.activeSources = [...validSources].sort(
      (a, b) => (a.priority ?? 99) - (b.priority ?? 99)
    );

    const candidateIdx = this.activeSources.findIndex(
      (s, idx) => idx >= startIndex && !this.isUrlRecentlyFailed(s.url)
    );
    this.activeSourceIndex =
      candidateIdx >= 0
        ? candidateIdx
        : Math.min(startIndex, this.activeSources.length - 1);

    const chosen = this.activeSources[this.activeSourceIndex];
    this.emitStatus(`${chosen.label} bağlanıyor...`, false);
    this.loadSource(chosen.url, currentToken);
  }

  public switchToNextSource(
    reason = "Kaynak değiştiriliyor",
    expectedToken = this.sessionToken
  ): boolean {
    if (
      expectedToken !== this.sessionToken ||
      !this.activeItem ||
      this.activeSources.length === 0
    ) {
      return false;
    }

    this.sessionToken += 1;
    const currentToken = this.sessionToken;

    const prevSrc = this.activeSources[this.activeSourceIndex];
    if (prevSrc) {
      this.failedTimestamps.set(prevSrc.url, Date.now());
    }

    const nextIdx = this.activeSourceIndex + 1;
    if (nextIdx < this.activeSources.length) {
      this.activeSourceIndex = nextIdx;
      const nextSrc = this.activeSources[this.activeSourceIndex];
      this.emitStatus(`${reason} → ${nextSrc.label} deneniyor...`, true);
      this.loadSource(nextSrc.url, currentToken);
      return true;
    }

    this.clearTimer();
    this.destroyHls();
    this.emitStatus("Tüm yedek kaynaklar denendi, yayın açılamadı.", true);
    return false;
  }

  public cycleSourceManual(): void {
    if (!this.activeItem || this.activeSources.length <= 1) return;

    this.sessionToken += 1;
    const currentToken = this.sessionToken;

    this.activeSourceIndex =
      (this.activeSourceIndex + 1) % this.activeSources.length;
    const chosen = this.activeSources[this.activeSourceIndex];
    this.failedTimestamps.delete(chosen.url);
    this.emitStatus(`Manuel geçiş: ${chosen.label}`, false);
    this.loadSource(chosen.url, currentToken);
  }

  private loadSource(url: string, token: number): void {
    if (token !== this.sessionToken) return;

    this.clearTimer();
    this.destroyHls();
    this.hasStartedPlaying = false;

    this.mediaEl.pause();
    this.mediaEl.removeAttribute("src");
    this.mediaEl.load();

    const isHls = /\.m3u8(\?.*)?$/i.test(url);
    const HlsLib = getWindowHls();

    if (isHls && HlsLib && HlsLib.isSupported()) {
      const hls = new HlsLib({ enableWorker: true });
      this.hlsInstance = hls;
      hls.loadSource(url);
      hls.attachMedia(this.mediaEl);

      hls.on(HlsLib.Events.ERROR, (_ev, data) => {
        if (token !== this.sessionToken || !this.hlsInstance) return;
        if (!data?.fatal) return;

        const mediaErrType = HlsLib.ErrorTypes?.MEDIA_ERROR;
        const netErrType = HlsLib.ErrorTypes?.NETWORK_ERROR;

        if (data.type === mediaErrType && !this.hlsMediaRecoveryAttempted) {
          this.hlsMediaRecoveryAttempted = true;
          this.emitStatus("Medya akışı kurtarılıyor...", true);
          this.hlsInstance.recoverMediaError();
          return;
        }

        if (data.type === netErrType) {
          this.hlsInstance.startLoad();
        }

        this.switchToNextSource("HLS akış hatası", token);
      });

      this.mediaEl.play().catch(() => {});
    } else {
      this.mediaEl.src = url;
      this.mediaEl.load();
      this.mediaEl.play().catch(() => {});
    }

    this.scheduleFailover("Bağlantı zaman aşımı", token);
  }

  public stop(): void {
    this.sessionToken += 1;
    this.clearTimer();
    this.destroyHls();
    this.hasStartedPlaying = false;
    this.activeItem = null;
    this.activeSources = [];
    this.mediaEl.pause();
    this.mediaEl.removeAttribute("src");
    this.mediaEl.load();
  }
}

export async function loadAllCatalogs(
  config: CatalogConfig,
  fallbackItems: Record<MediaCategory, MediaItem[]>
): Promise<Record<MediaCategory, MediaItem[]>> {
  const result: Record<MediaCategory, MediaItem[]> = {
    tv: [...fallbackItems.tv],
    radio: [...fallbackItems.radio],
    movie: [...fallbackItems.movie],
    series: [...fallbackItems.series],
  };

  async function fetchJson(url?: string): Promise<MediaItem[] | null> {
    if (!url) return null;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data)) return null;
      const valid = data.filter(isValidMediaItem);
      return valid.length > 0 ? valid : null;
    } catch {
      return null;
    }
  }

  const [tvJson, radioJson, movieJson, seriesJson] = await Promise.all([
    fetchJson(config.tvJsonUrl),
    fetchJson(config.radioJsonUrl),
    fetchJson(config.movieJsonUrl),
    fetchJson(config.seriesJsonUrl),
  ]);

  if (tvJson?.length) result.tv = tvJson;
  if (radioJson?.length) result.radio = radioJson;
  if (movieJson?.length) result.movie = movieJson;
  if (seriesJson?.length) result.series = seriesJson;

  if (config.tvM3uUrl) {
    try {
      const res = await fetch(config.tvM3uUrl, { cache: "no-store" });
      if (res.ok) {
        const m3uText = await res.text();
        const parsed = parseM3uToMediaItems(m3uText, "tv");
        if (parsed.length > 0) {
          result.tv = [...result.tv, ...parsed];
        }
      }
    } catch {
      // M3U çekilemezse mevcut TV listesi korunur
    }
  }

  return result;
}
