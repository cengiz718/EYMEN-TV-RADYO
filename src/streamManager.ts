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

/**
 * M3U metnini MediaItem dizisine dönüştürür ve aynı isimdeki kanalları
 * tek kart altında yedek kaynaklar (sources) olarak birleştirir.
 */
export function parseM3uToMediaItems(
  m3uText: string,
  category: MediaCategory = "tv"
): MediaItem[] {
  const lines = m3uText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const groupedMap = new Map<string, MediaItem>();
  let pendingMeta: {
    title: string;
    group: string;
    logo?: string;
  } | null = null;

  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const commaIdx = line.lastIndexOf(",");
      const title =
        commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : "İsimsiz Yayın";

      pendingMeta = {
        title,
        group: groupMatch?.[1]?.trim() || "Genel",
        logo: logoMatch?.[1]?.trim() || undefined,
      };
    } else if (!line.startsWith("#") && pendingMeta) {
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

/**
 * TV, Radyo, Film ve Dizi kaynaklarını yükler ve yedek kanal geçişini yönetir.
 */
export class EymenStreamController {
  private videoEl: HTMLVideoElement | HTMLAudioElement;
  private onStatus?: PlayerStatusListener;
  private timeoutMs: number;
  private failoverTimer: number | null = null;
  private failedUrls = new Set<string>();

  private activeItem: MediaItem | null = null;
  private activeSourceIndex = 0;

  constructor(
    mediaElement: HTMLVideoElement | HTMLAudioElement,
    options?: { failoverTimeoutMs?: number; onStatus?: PlayerStatusListener }
  ) {
    this.videoEl = mediaElement;
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

  private emitStatus(message: string, isError = false): void {
    if (!this.activeItem || !this.onStatus) return;
    const source = this.activeItem.sources[this.activeSourceIndex];
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
    this.videoEl.addEventListener("playing", () => {
      this.clearTimer();
      const src = this.activeItem?.sources[this.activeSourceIndex];
      this.emitStatus(`Yayında • ${src?.label ?? "Kaynak"}`, false);
    });

    this.videoEl.addEventListener("error", () => {
      this.switchToNextSource("Yayın hatası oluştu");
    });

    this.videoEl.addEventListener("stalled", () => {
      // Akış takılırsa zaman aşımı süresi dolduğunda yedek devreye girer
      if (this.failoverTimer === null && this.activeItem) {
        this.scheduleFailover("Akış yavaşladı / takıldı");
      }
    });
  }

  private scheduleFailover(reason: string): void {
    this.clearTimer();
    this.failoverTimer = window.setTimeout(() => {
      if (this.videoEl.readyState < 2 || this.videoEl.paused) {
        this.switchToNextSource(reason);
      }
    }, this.timeoutMs);
  }

  /**
   * Seçilen içeriği öncelikli (hataya düşmemiş) kaynaktan başlatır.
   */
  public playItem(item: MediaItem, startIndex = 0): void {
    if (!item.sources || item.sources.length === 0) return;

    this.activeItem = item;
    const sorted = [...item.sources].sort(
      (a, b) => (a.priority ?? 99) - (b.priority ?? 99)
    );
    item.sources = sorted;

    // Daha önce bu oturumda hata vermemiş ilk kaynağı seç
    const preferredIdx = sorted.findIndex(
      (s, idx) => idx >= startIndex && !this.failedUrls.has(s.url)
    );
    this.activeSourceIndex = preferredIdx >= 0 ? preferredIdx : startIndex;

    const chosen = item.sources[this.activeSourceIndex];
    this.emitStatus(`${chosen.label} bağlanıyor...`, false);
    this.loadSource(chosen.url);
  }

  /**
   * Sıradaki yedek kaynağa otomatik veya manuel geçiş yapar.
   */
  public switchToNextSource(reason = "Kaynak değiştiriliyor"): boolean {
    if (!this.activeItem || this.activeItem.sources.length === 0) return false;

    const currentSrc = this.activeItem.sources[this.activeSourceIndex];
    if (currentSrc && reason !== "Manuel geçiş") {
      this.failedUrls.add(currentSrc.url);
    }

    const nextIndex = this.activeSourceIndex + 1;
    if (nextIndex < this.activeItem.sources.length) {
      this.activeSourceIndex = nextIndex;
      const nextSrc = this.activeItem.sources[this.activeSourceIndex];
      this.emitStatus(`${reason} → ${nextSrc.label} deneniyor...`, true);
      this.loadSource(nextSrc.url);
      return true;
    }

    this.clearTimer();
    this.emitStatus("Tüm yedek kaynaklar denendi, yayın açılamadı.", true);
    return false;
  }

  /**
   * Kullanıcı kumanda/butonla döngüsel olarak kaynak değiştirmek istediğinde çalışır.
   */
  public cycleSourceManual(): void {
    if (!this.activeItem || this.activeItem.sources.length <= 1) return;
    this.activeSourceIndex =
      (this.activeSourceIndex + 1) % this.activeItem.sources.length;
    const chosen = this.activeItem.sources[this.activeSourceIndex];
    this.emitStatus(`Manuel geçiş: ${chosen.label}`, false);
    this.loadSource(chosen.url);
  }

  private loadSource(url: string): void {
    this.clearTimer();
    this.videoEl.pause();
    this.videoEl.src = url;
    this.videoEl.load();
    this.videoEl.play().catch(() => {
      // Hata veya zaman aşımı yakalayıcıları yedek geçişi yönetir
    });
    this.scheduleFailover("Bağlantı zaman aşımı");
  }

  public stop(): void {
    this.clearTimer();
    this.activeItem = null;
    this.videoEl.pause();
    this.videoEl.removeAttribute("src");
    this.videoEl.load();
  }
}

/**
 * TV, Radyo, Film ve Dizi kataloglarını tek seferde toplar.
 */
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
      return Array.isArray(data) ? data : null;
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
