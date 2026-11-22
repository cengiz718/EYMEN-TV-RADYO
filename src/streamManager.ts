import Hls from "hls.js";

export type MediaCategory = "tv" | "radio" | "movie" | "series";
export type ActiveMediaCategory = Extract<MediaCategory, "tv" | "radio">;

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

export interface CatalogUrls {
  tv?: string[];
  radio?: string[];
}

export interface StreamStatusEvent {
  state: "idle" | "loading" | "playing" | "failover" | "error" | "stopped";
  message: string;
  source?: StreamSource;
}

export interface EymenStreamControllerOptions {
  failoverTimeoutMs?: number;
  onStatus?: (event: StreamStatusEvent) => void;
}

const DEFAULT_TIMEOUT_MS = 5000;

function isValidUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function cleanStreamTitle(rawTitle: string): string {
  return (rawTitle || "")
    .replace(/\s+/g, " ")
    .replace(/\bT\s*R\s*K\s*E\b/gi, "TÜRKÇE")
    .replace(/\bS\s*N\s*E\s*M\s*A\b/gi, "SİNEMA")
    .replace(/\bM\s*Z\s*K\b/gi, "MÜZİK")
    .replace(/\bB\s*L\s*M\s*KURGU\b/gi, "BİLİM KURGU")
    .trim();
}

function normalizeSources(item: MediaItem): StreamSource[] {
  const rawSources = Array.isArray(item.sources) ? item.sources : [];
  const valid = rawSources
    .map((s, idx) => {
      const candidateUrl =
        (s as unknown as { url?: string; streamUrl?: string; link?: string })?.url ??
        (s as unknown as { streamUrl?: string })?.streamUrl ??
        (s as unknown as { link?: string })?.link ??
        "";

      if (!isValidUrl(candidateUrl)) return null;

      return {
        id: String(s?.id || `${item.id}-s${idx + 1}`),
        label: String(s?.label || (idx === 0 ? "Ana Yayın" : `Yedek Yayın ${idx}`)),
        url: candidateUrl.trim().replace(/(?<!:)\/{2,}/g, "/"),
        priority: typeof s?.priority === "number" ? s.priority : idx + 1,
      };
    })
    .filter((entry): entry is StreamSource => entry !== null);

  return valid.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

function normalizeMediaItem(
  raw: unknown,
  category: ActiveMediaCategory,
  fallbackIndex: number
): MediaItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rawTitle =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim()
      : `Yayın ${fallbackIndex + 1}`;
  const title = cleanStreamTitle(rawTitle) || `Yayın ${fallbackIndex + 1}`;

  const item: MediaItem = {
    id:
      typeof obj.id === "string" && obj.id.trim()
        ? obj.id.trim()
        : `${category}-${fallbackIndex + 1}`,
    title,
    category,
    group:
      typeof obj.group === "string" && obj.group.trim()
        ? obj.group.trim()
        : category === "tv"
          ? "Canlı TV"
          : "Radyo",
    logo:
      typeof obj.logo === "string" && isValidUrl(obj.logo)
        ? obj.logo.trim()
        : undefined,
    sources: [],
  };

  item.sources = normalizeSources({
    ...item,
    sources: Array.isArray(obj.sources) ? (obj.sources as StreamSource[]) : [],
  });

  if (item.sources.length === 0) return null;
  return item;
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?.*)?$/i.test(url.trim());
}

export class EymenStreamController {
  private mediaEl: HTMLMediaElement;
  private failoverTimeoutMs: number;
  private onStatus?: (event: StreamStatusEvent) => void;
  private timerId: number | null = null;
  private hlsInstance: Hls | null = null;
  private currentItem: MediaItem | null = null;
  private sources: StreamSource[] = [];
  private currentIndex = 0;
  private sessionId = 0;
  private isStopped = false;

  constructor(
    mediaEl: HTMLMediaElement,
    options: EymenStreamControllerOptions = {}
  ) {
    this.mediaEl = mediaEl;
    this.failoverTimeoutMs = options.failoverTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onStatus = options.onStatus;

    this.mediaEl.addEventListener("playing", this.handlePlaying);
    this.mediaEl.addEventListener("error", this.handleMediaError);
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private destroyHls(): void {
    if (this.hlsInstance) {
      try {
        this.hlsInstance.stopLoad();
        this.hlsInstance.detachMedia();
        this.hlsInstance.destroy();
      } catch (_) {
        // ignore cleanup error
      }
      this.hlsInstance = null;
    }
  }

  private emit(event: StreamStatusEvent): void {
    this.onStatus?.(event);
  }

  private handlePlaying = (): void => {
    if (this.isStopped || !this.currentItem) return;
    this.clearTimer();
    const activeSource = this.sources[this.currentIndex];
    this.emit({
      state: "playing",
      message: `${this.currentItem.title} oynatılıyor (${
        activeSource?.label ?? "Ana Kaynak"
      })`,
      source: activeSource,
    });
  };

  private handleMediaError = (): void => {
    if (
      this.isStopped ||
      !this.currentItem ||
      !this.mediaEl.getAttribute("src")
    ) {
      return;
    }
    this.tryNextSource("Akış hatası oluştu", this.sessionId);
  };

  private armFailoverTimer(activeSession: number): void {
    this.clearTimer();
    this.timerId = window.setTimeout(() => {
      if (!this.isStopped && activeSession === this.sessionId) {
        this.tryNextSource("Yayın zaman aşımına uğradı", activeSession);
      }
    }, this.failoverTimeoutMs);
  }

  private async attachAndPlay(
    source: StreamSource,
    activeSession: number
  ): Promise<void> {
    if (this.isStopped || activeSession !== this.sessionId) return;

    this.destroyHls();
    this.clearTimer();

    try {
      this.mediaEl.pause();
      this.mediaEl.removeAttribute("src");
      this.mediaEl.load();
    } catch (_) {
      // ignore media reset warning
    }

    this.emit({
      state: "loading",
      message: `${this.currentItem?.title ?? "Yayın"} • ${source.label} deneniyor...`,
      source,
    });

    this.armFailoverTimer(activeSession);

    const url = source.url.trim();

    try {
      if (isHlsUrl(url) && Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        this.hlsInstance = hls;

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (this.isStopped || activeSession !== this.sessionId) return;
          if (data?.fatal) {
            this.tryNextSource("HLS akışı yanıt vermedi", activeSession);
          }
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (this.isStopped || activeSession !== this.sessionId) return;
          void this.mediaEl.play().catch(() => {
            // Autoplay kısıtı durumunda kullanıcı etkileşimi beklenir
          });
        });

        hls.loadSource(url);
        hls.attachMedia(this.mediaEl);
      } else {
        this.mediaEl.src = url;
        this.mediaEl.load();
        const playPromise = this.mediaEl.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {
            // Autoplay engeli veya akış hatası
          });
        }
      }
    } catch (_) {
      this.tryNextSource("Kaynak açılamadı", activeSession);
    }
  }

  private tryNextSource(reason: string, activeSession: number): void {
    if (
      this.isStopped ||
      activeSession !== this.sessionId ||
      this.sources.length === 0
    ) {
      return;
    }

    this.clearTimer();

    if (this.currentIndex + 1 < this.sources.length) {
      this.currentIndex += 1;
      const nextSource = this.sources[this.currentIndex];
      this.emit({
        state: "failover",
        message: `${reason} — ${nextSource.label} geçiliyor...`,
        source: nextSource,
      });
      void this.attachAndPlay(nextSource, activeSession);
    } else {
      this.emit({
        state: "error",
        message: `${
          this.currentItem?.title ?? "Yayın"
        } için tüm kaynaklar başarısız oldu`,
      });
    }
  }

  public playItem(item: MediaItem, startIndex = 0): void {
    this.sessionId += 1;
    const activeSession = this.sessionId;
    this.isStopped = false;
    this.currentItem = item;
    this.sources = normalizeSources(item);
    this.currentIndex = Math.max(
      0,
      Math.min(startIndex, Math.max(0, this.sources.length - 1))
    );

    if (this.sources.length === 0) {
      this.clearTimer();
      this.destroyHls();
      this.emit({
        state: "error",
        message: `${item.title} için aktif yayın bağlantısı bulunamadı`,
      });
      return;
    }

    void this.attachAndPlay(this.sources[this.currentIndex], activeSession);
  }

  public cycleSourceManual(): void {
    if (!this.currentItem || this.sources.length === 0) return;
    this.sessionId += 1;
    const activeSession = this.sessionId;
    this.isStopped = false;
    this.currentIndex = (this.currentIndex + 1) % this.sources.length;
    void this.attachAndPlay(this.sources[this.currentIndex], activeSession);
  }

  public stop(): void {
    this.sessionId += 1;
    this.isStopped = true;
    this.clearTimer();
    this.destroyHls();
    try {
      this.mediaEl.pause();
      this.mediaEl.removeAttribute("src");
      this.mediaEl.load();
    } catch (_) {
      // ignore stop cleanup error
    }
    this.emit({
      state: "stopped",
      message: "Yayın durduruldu",
    });
  }

  public destroy(): void {
    this.stop();
    this.mediaEl.removeEventListener("playing", this.handlePlaying);
    this.mediaEl.removeEventListener("error", this.handleMediaError);
  }
}

export function parseM3uToItems(
  m3uText: string,
  category: ActiveMediaCategory
): MediaItem[] {
  const lines = m3uText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const grouped = new Map<string, MediaItem>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXTINF:")) continue;

    const nextLine = lines[i + 1];
    // Sonraki satır yoksa veya yeni bir # satırıysa #EXTINF yarım kalmış demektir -> atla
    if (!nextLine || nextLine.startsWith("#")) {
      continue;
    }

    const cleanUrl = nextLine.trim().replace(/(?<!:)\/{2,}/g, "/");
    if (!isValidUrl(cleanUrl)) {
      i++;
      continue;
    }

    const tvgNameMatch = line.match(/tvg-name="([^"]*)"/i);
    const groupMatch = line.match(/group-title="([^"]*)"/i);
    const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
    const titleMatch = line.match(/,(.+)$/);

    const currentGroup =
      groupMatch?.[1]?.trim() || (category === "tv" ? "Canlı TV" : "Radyo");
    const currentLogo = logoMatch?.[1]?.trim() || "";
    const rawTitle =
      tvgNameMatch?.[1]?.trim() ||
      titleMatch?.[1]?.trim() ||
      `Yayın ${grouped.size + 1}`;
    const currentTitle = cleanStreamTitle(rawTitle) || `Yayın ${grouped.size + 1}`;

    const key = `${category}:${currentTitle.toLowerCase()}`;
    const existing = grouped.get(key);

    if (existing) {
      const alreadyHasUrl = existing.sources.some((s) => s.url === cleanUrl);
      if (!alreadyHasUrl) {
        const nextNum = existing.sources.length + 1;
        existing.sources.push({
          id: `${existing.id}-s${nextNum}`,
          label: `Yedek Yayın ${nextNum - 1}`,
          url: cleanUrl,
          priority: nextNum,
        });
      }
    } else {
      const baseId = `${category}-${grouped.size + 1}`;
      grouped.set(key, {
        id: baseId,
        title: currentTitle,
        category,
        group: currentGroup,
        logo: isValidUrl(currentLogo) ? currentLogo : undefined,
        sources: [
          {
            id: `${baseId}-s1`,
            label: "Ana Yayın",
            url: cleanUrl,
            priority: 1,
          },
        ],
      });
    }

    i++; // URL satırını işlediğimiz için bir sonraki satıra geç
  }

  return Array.from(grouped.values());
}

async function fetchCategoryList(
  urls: string[] | undefined,
  category: ActiveMediaCategory,
  fallback: MediaItem[]
): Promise<MediaItem[]> {
  if (!urls || urls.length === 0) {
    return fallback;
  }

  for (const url of urls) {
    if (!isValidUrl(url)) continue;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      window.clearTimeout(timeout);
      if (!res.ok) continue;

      const text = await res.text();
      const trimmed = text.trim();

      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed);
        const list = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { items?: unknown[] })?.items)
            ? (parsed as { items: unknown[] }).items
            : [];

        const normalized = list
          .map((item, idx) => normalizeMediaItem(item, category, idx))
          .filter((item): item is MediaItem => item !== null);

        if (normalized.length > 0) {
          return normalized;
        }
      } else if (trimmed.includes("#EXTINF:") || /^https?:\/\//m.test(trimmed)) {
        const items = parseM3uToItems(trimmed, category);
        if (items.length > 0) {
          return items;
        }
      }
    } catch (_) {
      window.clearTimeout(timeout);
    }
  }

  return fallback;
}

export async function loadAllCatalogs(
  urls: CatalogUrls = {},
  fallback: Record<MediaCategory, MediaItem[]>
): Promise<Record<MediaCategory, MediaItem[]>> {
  const [tv, radio] = await Promise.all([
    fetchCategoryList(urls.tv, "tv", fallback.tv || []),
    fetchCategoryList(urls.radio, "radio", fallback.radio || []),
  ]);

  return {
    tv,
    radio,
    movie: [],
    series: [],
  };
}
