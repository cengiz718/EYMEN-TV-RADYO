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

const DEFAULT_TIMEOUT_MS = 8000;
const FOREIGN_BLOCK_REGEX =
  /\b(GERMANY|ALMANYA|LIEBESFILM|BUNDESLIGA|SKY DE|ZDF|RTL DE|PRO7 DE|ENGLISH|UK CHANNEL|USA CHANNEL|ARABIC|KURDISH)\b/i;
const TURKISH_ALLOW_REGEX =
  /[çğıöşüÇĞİÖŞÜ]|\b(TR|TURK|TURKIYE|TURKCE|TRT|ATV|SHOW|STAR|KANAL|TV8|NOW|FOX|HABER|SPOR|BEYAZ|TELE|HALK|SOZCU|ULKE|A SPOR|A HABER|NTV|CNN TURK|TGRT|KRAL|POWER|JOY|FENOMEN|PAL|ALEM|SLOW|ARABESK|TURKU|RADYO|RADIO|FM|SINEMA|DIZI|BELGESEL|COCUK|MINIKA)\b/i;

function isValidUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function cleanStreamTitle(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^\s*\d+\s*-\s*/, "")
    .trim();
}

export function isTurkishStream(title: string, group = ""): boolean {
  const combined = `${title} ${group}`.trim();
  if (FOREIGN_BLOCK_REGEX.test(combined)) return false;
  if (/^(TURKEY|TR|TURKIYE|TÜRKİYE)$/i.test(group.trim())) return true;
  return TURKISH_ALLOW_REGEX.test(combined);
}

export function detectTurkishGroup(title: string, category: ActiveMediaCategory): string {
  const text = title.toLocaleUpperCase("tr-TR");
  if (category === "radio") {
    if (/TÜRKÜ|TURKU|HALK|THM/.test(text)) return "Türkü & Halk Müziği";
    if (/ARABESK|FANTEZİ|FANTEZI|DAMAR/.test(text)) return "Arabesk & Fantezi";
    if (/POP|SLOW|JOY|POWER|FENOMEN|ALEM|PAL/.test(text)) return "Pop & Slow";
    if (/HABER|SPOR|NTV/.test(text)) return "Haber & Spor Radyo";
    return "Genel Radyo";
  }
  if (/TRT\s*1|ATV|SHOW|STAR|KANAL\s*D|TV\s*8|NOW|FOX|BEYAZ|KANAL\s*7|TEVE2/.test(text)) {
    return "Ulusal";
  }
  if (/HABER|NTV|CNN|HALK|SÖZCÜ|SOZCU|TELE\s*1|ÜLKE|ULKE|TGRT|KRT|FLASH|BLOOMBERG/.test(text)) {
    return "Haber";
  }
  if (/SPOR|SPORT|BEIN|S\s*SPORT|TİVİBU|TIVIBU|FB\s*TV|GS\s*TV|BJK/.test(text)) {
    return "Spor";
  }
  if (/SİNEMA|SINEMA|FİLM|FILM|DİZİ|DIZI/.test(text)) {
    return "Sinema & Dizi";
  }
  if (/ÇOCUK|COCUK|MİNİKA|MINIKA|CARTOON/.test(text)) {
    return "Çocuk";
  }
  if (/BELGESEL|NATIONAL|DISCOVERY|ANIMAL/.test(text)) {
    return "Belgesel";
  }
  if (/YEREL|BELEDİYE|BELEDIYE/.test(text)) {
    return "Yerel";
  }
  return "Genel";
}

function parseAttributes(line: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([\w-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

function parseM3u(text: string, requestedCategory: ActiveMediaCategory): MediaItem[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const items: MediaItem[] = [];
  let pending: { title: string; group: string; logo?: string; radio: boolean } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const title = cleanStreamTitle(comma >= 0 ? line.slice(comma + 1) : "Yayın");
      const attrs = parseAttributes(line);
      const group = attrs["group-title"] || "";
      pending = {
        title,
        group,
        logo: attrs["tvg-logo"],
        // Listede grup adı "Turkey" olduğu için radyo türünü kanal adından da algıla.
        radio:
          attrs.radio === "true" ||
          /RADYO|RADIO/i.test(group) ||
          /\\b(RADYO|RADIO|FM)\\b/i.test(title),
      };
      continue;
    }
    if (line.startsWith("#") || !pending || !isValidUrl(line)) continue;

    const category: ActiveMediaCategory = pending.radio ? "radio" : "tv";
    const isMovieOrSeries =
      /\\b(SINEMA|SİNEMA|CINEMA|MOVIE|FILM|FİLM|DIZI|DİZİ|SERIES)\\b/i.test(pending.title);
    if (
      category !== requestedCategory ||
      (requestedCategory === "tv" && isMovieOrSeries) ||
      !isTurkishStream(pending.title, pending.group)
    ) {
      pending = null;
      continue;
    }
    const cleanUrl = line.trim();
    const id = `${category}-${items.length}-${pending.title
      .toLocaleLowerCase("tr-TR")
      .replace(/[^a-z0-9]+/g, "-")}`;
    items.push({
      id,
      title: pending.title,
      category,
      group: pending.group || detectTurkishGroup(pending.title, category),
      logo: pending.logo,
      sources: [{ id: `${id}-source-1`, label: "Ana yayın", url: cleanUrl, priority: 1 }],
    });
    pending = null;
  }
  return items;
}

function normalizeJsonCatalog(value: unknown, category: ActiveMediaCategory): MediaItem[] {
  const root = value as { items?: unknown; channels?: unknown; data?: unknown } | unknown;
  const list = Array.isArray(root)
    ? root
    : Array.isArray((root as { items?: unknown })?.items)
      ? (root as { items: unknown[] }).items
      : Array.isArray((root as { channels?: unknown })?.channels)
        ? (root as { channels: unknown[] }).channels
        : Array.isArray((root as { data?: unknown })?.data)
          ? (root as { data: unknown[] }).data
          : [];

  return list.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const title = cleanStreamTitle(String(item.title ?? item.name ?? item.channel ?? ""));
    const group = String(item.group ?? item.groupTitle ?? item.categoryName ?? "");
    const rawSources = Array.isArray(item.sources) ? item.sources : [item];
    const sources: StreamSource[] = rawSources.flatMap((source, sourceIndex) => {
      if (!source || typeof source !== "object") return [];
      const candidate = source as Record<string, unknown>;
      const rawUrl = candidate.url ?? candidate.src ?? candidate.link;
      if (!isValidUrl(rawUrl)) return [];
      return [
        {
          id: String(candidate.id ?? `${category}-${index}-source-${sourceIndex}`),
          label: String(
            candidate.label ??
              candidate.name ??
              (sourceIndex === 0 ? "Ana yayın" : `Kaynak ${sourceIndex + 1}`)
          ),
          url: rawUrl.trim(),
          priority: Number(candidate.priority ?? sourceIndex + 1),
        },
      ];
    });
    if (!title || sources.length === 0 || !isTurkishStream(title, group)) return [];
    return [
      {
        id: String(
          item.id ??
            `${category}-${index}-${title.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9]+/g, "-")}`
        ),
        title,
        category,
        group: group || detectTurkishGroup(title, category),
        logo:
          typeof item.logo === "string"
            ? item.logo
            : typeof item.image === "string"
              ? item.image
              : undefined,
        sources: sources.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)),
      },
    ];
  });
}

async function loadCatalog(
  urls: string[] | undefined,
  category: ActiveMediaCategory
): Promise<MediaItem[]> {
  if (!urls?.length) return [];
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Liste alınamadı: HTTP ${response.status}`);
      const body = await response.text();
      if (body.trimStart().startsWith("#EXTM3U")) return parseM3u(body, category);
      return normalizeJsonCatalog(JSON.parse(body), category);
    })
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

export async function loadAllCatalogs(
  urls: CatalogUrls,
  fallback: Record<MediaCategory, MediaItem[]>
): Promise<{ tv: MediaItem[]; radio: MediaItem[] }> {
  const [remoteTv, remoteRadio] = await Promise.all([
    loadCatalog(urls.tv, "tv"),
    loadCatalog(urls.radio, "radio"),
  ]);
  const merge = (remote: MediaItem[], local: MediaItem[]) => {
    const combined = [...remote, ...local];
    const seen = new Set<string>();
    return combined.filter((item) => {
      const key = item.title.toLocaleLowerCase("tr-TR");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return {
    tv: merge(remoteTv, fallback.tv ?? []),
    radio: merge(remoteRadio, fallback.radio ?? []),
  };
}

export class EymenStreamController {
  private hls: Hls | null = null;
  private currentItem: MediaItem | null = null;
  private sourceIndex = 0;
  private timeoutId: number | null = null;
  private attemptToken = 0;
  private destroyed = false;
  private readonly timeoutMs: number;
  private readonly onStatus?: (event: StreamStatusEvent) => void;

  constructor(
    private readonly media: HTMLVideoElement,
    options: EymenStreamControllerOptions = {}
  ) {
    this.timeoutMs = options.failoverTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onStatus = options.onStatus;
    this.media.addEventListener("playing", this.handlePlaying);
    this.media.addEventListener("error", this.handleMediaError);
  }

  private emit(event: StreamStatusEvent): void {
    this.onStatus?.(event);
  }

  private clearPlayback(): void {
    if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
    this.timeoutId = null;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.media.pause();
    this.media.removeAttribute("src");
    this.media.load();
  }

  playItem(item: MediaItem, startIndex = 0): void {
    if (this.destroyed) return;
    if (!item.sources?.length) {
      this.emit({ state: "error", message: "Bu kanal için yayın adresi bulunamadı." });
      return;
    }
    this.currentItem = item;
    this.sourceIndex = Math.max(0, Math.min(startIndex, item.sources.length - 1));
    this.tryCurrentSource(false);
  }

  private tryCurrentSource(isFailover: boolean): void {
    const item = this.currentItem;
    if (!item || this.destroyed) return;
    const source = item.sources[this.sourceIndex];
    if (!source || !isValidUrl(source.url)) {
      this.moveToNextSource();
      return;
    }

    this.clearPlayback();
    const token = ++this.attemptToken;
    this.emit({
      state: isFailover ? "failover" : "loading",
      message: isFailover ? `${source.label} deneniyor...` : `${item.title} yükleniyor...`,
      source,
    });

    this.timeoutId = window.setTimeout(() => {
      if (token === this.attemptToken) this.moveToNextSource();
    }, this.timeoutMs);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingTimeOut: this.timeoutMs,
        levelLoadingTimeOut: this.timeoutMs,
        fragLoadingTimeOut: this.timeoutMs,
      });
      this.hls = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (token !== this.attemptToken) return;
        void this.media.play().catch(() => {
          this.emit({
            state: "loading",
            message: "Oynatmak için ekrana dokunun veya OK tuşuna basın.",
            source,
          });
        });
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (token === this.attemptToken && data.fatal) this.moveToNextSource();
      });
      hls.loadSource(source.url);
      hls.attachMedia(this.media);
    } else {
      this.media.src = source.url;
      this.media.load();
      void this.media.play().catch(() => {
        this.emit({
          state: "loading",
          message: "Oynatmak için ekrana dokunun veya OK tuşuna basın.",
          source,
        });
      });
    }
  }

  private readonly handlePlaying = (): void => {
    if (this.timeoutId !== null) window.clearTimeout(this.timeoutId);
    this.timeoutId = null;
    this.emit({
      state: "playing",
      message: this.currentItem ? `${this.currentItem.title} yayında` : "Yayın oynatılıyor",
      source: this.currentItem?.sources[this.sourceIndex],
    });
  };

  private readonly handleMediaError = (): void => {
    if (!this.hls && this.currentItem) this.moveToNextSource();
  };

  private moveToNextSource(): void {
    const item = this.currentItem;
    if (!item || this.destroyed) return;
    if (this.sourceIndex + 1 < item.sources.length) {
      this.sourceIndex += 1;
      this.tryCurrentSource(true);
    } else {
      this.clearPlayback();
      this.emit({ state: "error", message: `${item.title} için çalışan yayın kaynağı bulunamadı.` });
    }
  }

  cycleSourceManual(): void {
    const item = this.currentItem;
    if (!item || item.sources.length < 2 || this.destroyed) return;
    this.sourceIndex = (this.sourceIndex + 1) % item.sources.length;
    this.tryCurrentSource(true);
  }

  stop(): void {
    this.attemptToken += 1;
    this.clearPlayback();
    this.currentItem = null;
    this.sourceIndex = 0;
    this.emit({ state: "stopped", message: "Yayın durduruldu." });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.media.removeEventListener("playing", this.handlePlaying);
    this.media.removeEventListener("error", this.handleMediaError);
  }
}
