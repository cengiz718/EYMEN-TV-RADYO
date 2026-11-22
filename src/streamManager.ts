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

const FOREIGN_BLOCK_REGEX =
  /\b(GERMANY|DE|ALMANYA|LIEBESFILM|BUNDESLIGA|SKY|ZDF|RTL|PRO7|PRO\s*7|SAT\.?1|KABEL\s*1|VOX|NTV\s*DE|WELT|ARD|KIKA|DISNEY\s*CHANNEL\s*DE|ENGLISH|UK|USA|FR|ES|ARABIC|KURDISH)\b/i;

const TURKISH_ALLOW_REGEX =
  /[çğıöşüÇĞİÖŞÜ]|\b(TR|TURK|TURKIYE|TURKCE|TRT|ATV|SHOW|STAR|KANAL|TV8|TV\s*8|NOW|FOX|HABER|SPOR|BEYAZ|TELE|HALK|SZCU|SOZCU|ULKE|24|A\s*SPOR|A\s*HABER|A\s*PARA|NTV|CNN\s*TURK|TGRT|KRAL|POWER|JOY|FENOMEN|PAL|ALEM|SLOW|ARABESK|TURKU|RADYO|RADIO|FM|SINEMA|DIZI|BELGESEL|COCUK|MINIKA)\b/i;

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

export function isTurkishStream(title: string, group?: string): boolean {
  const grp = (group || "").trim();
  const combined = `${title} ${grp}`.trim();

  if (FOREIGN_BLOCK_REGEX.test(combined)) {
    return false;
  }

  if (/^(GERMANY|DE|ALMANYA)$/i.test(grp)) {
    return false;
  }

  if (/^(TURKEY|TR|TURKIYE|TÜRKİYE)$/i.test(grp)) {
    return true;
  }

  return TURKISH_ALLOW_REGEX.test(combined);
}

export function detectTurkishGroup(
  title: string,
  category: ActiveMediaCategory
): string {
  const text = title.toUpperCase();

  if (category === "radio") {
    if (/\b(TÜRKÜ|TURKU|HALK|THM)\b/.test(text)) return "Türkü & Halk Müziği";
    if (/\b(ARABESK|FANTEZİ|FANTEZI|DAMAR|Kral\s*FM)\b/i.test(text))
      return "Arabesk & Fantezi";
    if (/\b(POP|SLOW|JOY|POWER|FENOMEN|ALEM|PAL|SÜPER|SUPER)\b/.test(text))
      return "Pop & Slow";
    if (/\b(HABER|SPOR|NTV|TRT\s*RADYO\s*1|A\s*HABER)\b/.test(text))
      return "Haber & Spor Radyo";
    return "Genel Radyo";
  }

  if (
    /\b(TRT\s*1|ATV|SHOW|STAR|KANAL\s*D|TV8|TV\s*8|NOW|FOX|BEYAZ|KANAL\s*7|360|TEVE2|TV2)\b/.test(
      text
    )
  ) {
    return "Ulusal";
  }

  if (
    /\b(HABER|NTV|CNN|HALK|SÖZCÜ|SOZCU|TELE\s*1|ÜLKE|ULKE|24|TGRT|KRT|FLASH|A\s*PARA|BLOOMBERG|EKOTÜRK|EKOTURK)\b/.test(
      text
    )
  ) {
    return "Haber";
  }

  if (/\b(SPOR|SPORT|BEIN|S\s*SPORT|TİVİBU|TIVIBU|FB\s*TV|GS\s*TV|BJK)\b/.test(text)) {
    return "Spor";
  }

  if (
    /\b(SİNEMA|SINEMA|FİLM|FILM|DİZİ|DIZI|YE
