import type { EpgNowNext } from '../types/channel';

export function normalizeEpgKey(raw: string): string {
  let s = raw
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 's')
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'g')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'u')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'o')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'c')
    .toUpperCase();

  s = s
    .replace(/\.TR$/g, '')
    .replace(/^(4K\s*TR:|TR:|TR\s+|HD\s*TR:)/g, '')
    .replace(/\b(4K|UHD|FHD|HD|SD|HEVC|H265|RAW|PLUS|TURKEY)\b/g, ' ')
    .replace(/[^A-Z0-9]/g, '');

  return s;
}

export function lookupEpgForChannel(
  epgMap: Record<string, EpgNowNext>,
  channelName: string
): EpgNowNext | null {
  const norm = normalizeEpgKey(channelName);
  if (!norm) return null;
  if (epgMap[norm]) return epgMap[norm];
  if (epgMap[`${norm}TV`]) return epgMap[`${norm}TV`];
  if (norm.endsWith('TV') && epgMap[norm.slice(0, -2)]) {
    return epgMap[norm.slice(0, -2)];
  }
  return null;
}

export function formatEpgTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function computeEpgProgress(startMs: number, stopMs: number): number {
  const now = Date.now();
  if (stopMs <= startMs) return 0;
  const pct = ((now - startMs) / (stopMs - startMs)) * 100;
  return Math.max(0, Math.min(100, pct));
}
