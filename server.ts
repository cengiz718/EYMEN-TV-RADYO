import express, { type Request, type Response } from 'express';
import { Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const DEFAULT_EPG_URL =
  'https://epgshare01.online/epgshare01/epg_ripper_TR1.xml.gz';

interface EpgProgramme {
  channelId: string;
  startMs: number;
  stopMs: number;
  title: string;
  desc?: string;
}

interface EpgCacheEntry {
  fetchedAt: number;
  sourceUrl: string;
  // Map from normalized channel name -> sorted programmes
  byNormName: Map<string, EpgProgramme[]>;
  channelAliases: Map<string, string>;
}

const epgCache = new Map<string, EpgCacheEntry>();
const EPG_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

let defaultPlaylistCache: string | null = null;

interface CachedHlsResponse {
  status: number;
  contentType: string;
  body: Buffer;
  isPlaylist: boolean;
  expiresAt: number;
}

const MAX_HLS_CACHE_BYTES = 120 * 1024 * 1024; // 120 MB bounded LRU
const MAX_SINGLE_SEGMENT_BYTES = 10 * 1024 * 1024; // 10 MB cap per segment
const hlsCache = new Map<string, CachedHlsResponse>();
const inFlightHls = new Map<string, Promise<CachedHlsResponse>>();
let hlsCacheBytes = 0;

function setHlsCacheEntry(key: string, entry: CachedHlsResponse) {
  if (entry.body.byteLength > MAX_SINGLE_SEGMENT_BYTES) return;
  const existing = hlsCache.get(key);
  if (existing) {
    hlsCacheBytes -= existing.body.byteLength;
    hlsCache.delete(key);
  }
  while (hlsCacheBytes + entry.body.byteLength > MAX_HLS_CACHE_BYTES && hlsCache.size > 0) {
    const oldestKey = hlsCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = hlsCache.get(oldestKey);
    if (oldest) hlsCacheBytes -= oldest.body.byteLength;
    hlsCache.delete(oldestKey);
  }
  hlsCache.set(key, entry);
  hlsCacheBytes += entry.body.byteLength;
}

function getHlsCacheEntry(key: string): CachedHlsResponse | null {
  const entry = hlsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    hlsCacheBytes -= entry.body.byteLength;
    hlsCache.delete(key);
    return null;
  }
  // Refresh LRU order
  hlsCache.delete(key);
  hlsCache.set(key, entry);
  return entry;
}

interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  codec: string;
  bitrate: number;
  hls: number;
  lastcheckok: number;
}

interface CachedRadioList {
  fetchedAt: number;
  stations: Array<{
    id: string;
    name: string;
    streamUrl: string;
    logoUrl: string | null;
    tags: string;
    codec: string;
    bitrate: number;
    country: string;
  }>;
}

const radioCache = new Map<string, CachedRadioList>();
const RADIO_CACHE_TTL_MS = 15 * 60 * 1000;

const FALLBACK_TURKISH_RADIOS: CachedRadioList['stations'] = [
  {
    id: 'fallback_powerturk',
    name: 'PowerTürk FM',
    streamUrl: 'https://live.powerapp.com.tr/powerturk/abr/playlist.m3u8',
    logoUrl: 'https://www.powerapp.com.tr/i/favicov2/apple-icon-120x120.png',
    tags: 'pop,turkish',
    codec: 'AAC',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_powerpop',
    name: 'Power POP',
    streamUrl: 'https://listen.powerapp.com.tr/powerpop/128/chunks.m3u8',
    logoUrl: 'https://www.powerapp.com.tr/i/favicov2/apple-icon-120x120.png',
    tags: 'pop,hits',
    codec: 'AAC',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_kralfm',
    name: 'Kral FM',
    streamUrl: 'https://dygedge2.radyotvonline.net/kralfm/playlist.m3u8',
    logoUrl: null,
    tags: 'arabesk,damar',
    codec: 'AAC',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_kralpop',
    name: 'Kral Pop Radyo',
    streamUrl: 'https://ssldyg.radyotvonline.com/smil/smil:kralpop.smil/playlist.m3u8',
    logoUrl: null,
    tags: 'pop,turkish',
    codec: 'AAC',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_joyturk',
    name: 'JoyTürk FM',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_TURK_SC',
    logoUrl: null,
    tags: 'slow,pop',
    codec: 'MP3',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_superfm',
    name: 'Süper FM',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/SUPER_FM_SC',
    logoUrl: null,
    tags: 'pop,hit',
    codec: 'MP3',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_metrofm',
    name: 'Metro FM',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/METRO_FM_SC',
    logoUrl: null,
    tags: 'pop,dance,english',
    codec: 'MP3',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_virgin',
    name: 'Virgin Radio Türkiye',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/VIRGIN_RADIO_SC',
    logoUrl: null,
    tags: 'pop,rock',
    codec: 'MP3',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_alemfm',
    name: 'Alem FM',
    streamUrl: 'https://turkmedya.radyotvonline.net/alemfmaac',
    logoUrl: null,
    tags: 'pop,turkish',
    codec: 'AAC',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_bestfm',
    name: 'Best FM',
    streamUrl: 'https://ssldyg.radyotvonline.com/best/bestfm.stream/playlist.m3u8',
    logoUrl: null,
    tags: 'pop,talk',
    codec: 'AAC',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_fenomen',
    name: 'Radyo Fenomen',
    streamUrl: 'https://live.radyofenomen.com/fenomen/128/icecast.audio',
    logoUrl: null,
    tags: 'dance,pop,club',
    codec: 'AAC+',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_kafaradyo',
    name: 'Kafa Radyo',
    streamUrl: 'https://moondigitalmaster.radyotvonline.net/kafaradyo/playlist.m3u8',
    logoUrl: null,
    tags: 'talk,pop',
    codec: 'AAC+',
    bitrate: 64,
    country: 'Türkiye',
  },
  {
    id: 'fallback_trtturku',
    name: 'TRT Türkü',
    streamUrl: 'https://rd-trtturku.medya.trt.com.tr/master_128.m3u8',
    logoUrl: null,
    tags: 'türkü,halk',
    codec: 'AAC',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'fallback_turkuvaz',
    name: 'Radyo Turkuvaz',
    streamUrl: 'https://trkvz-radyolar.ercdn.net/radyoturkuvaz/playlist.m3u8',
    logoUrl: null,
    tags: 'pop,turkish',
    codec: 'AAC',
    bitrate: 64,
    country: 'Türkiye',
  },
  {
    id: 'fallback_damarturk',
    name: 'DamarTürk FM',
    streamUrl: 'https://live.radyositesihazir.com:10997/stream?type=http',
    logoUrl: null,
    tags: 'arabesk,damar',
    codec: 'MP3',
    bitrate: 128,
    country: 'Türkiye',
  },
];

function isPrivateOrBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return true;
    }
  }
  return false;
}

function validateExternalUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (isPrivateOrBlockedHost(parsed.hostname)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildProxyUrl(
  targetUrl: string,
  ua?: string,
  referer?: string,
  origin?: string
): string {
  const params = new URLSearchParams();
  params.set('url', targetUrl);
  if (ua) params.set('ua', ua);
  if (referer) params.set('referer', referer);
  if (origin) params.set('origin', origin);
  return `/api/stream?${params.toString()}`;
}

function rewriteM3u8Content(
  playlistText: string,
  baseUrl: string,
  ua?: string,
  referer?: string,
  origin?: string
): string {
  const lines = playlistText.split(/\r?\n/);
  const rewritten = lines.map((rawLine) => {
    const line = rawLine.trim();
    if (!line) return rawLine;

    if (line.startsWith('#')) {
      if (line.includes('URI="')) {
        return rawLine.replace(/URI="([^"]+)"/g, (_match, uriValue: string) => {
          try {
            const resolved = new URL(uriValue, baseUrl).toString();
            return `URI="${buildProxyUrl(resolved, ua, referer, origin)}"`;
          } catch {
            return `URI="${uriValue}"`;
          }
        });
      }
      return rawLine;
    }

    try {
      const resolved = new URL(line, baseUrl).toString();
      return buildProxyUrl(resolved, ua, referer, origin);
    } catch {
      return rawLine;
    }
  });
  return rewritten.join('\n');
}

function extractPlsUrl(plsText: string): string | null {
  const match = plsText.match(/^File\d+=(https?:\/\/[^\r\n]+)/im);
  return match ? match[1].trim() : null;
}

async function fetchOnlineRadios(scope: string): Promise<CachedRadioList['stations']> {
  const cacheKey = scope === 'global' ? 'global' : 'tr';
  const cached = radioCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < RADIO_CACHE_TTL_MS) {
    return cached.stations;
  }

  const endpointPath =
    cacheKey === 'global'
      ? '/json/stations/topclick/80?hidebroken=true'
      : '/json/stations/bycountrycodeexact/TR?limit=120&order=clickcount&reverse=true&hidebroken=true';

  const mirrors = [
    `https://de1.api.radio-browser.info${endpointPath}`,
    `https://fr1.api.radio-browser.info${endpointPath}`,
    `https://at1.api.radio-browser.info${endpointPath}`,
  ];

  for (const apiUrl of mirrors) {
    try {
      const resp = await fetch(apiUrl, {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'EymenTVRadyo/1.0',
          Accept: 'application/json',
        },
      });
      if (!resp.ok) continue;
      const rawList = (await resp.json()) as RadioBrowserStation[];
      if (!Array.isArray(rawList) || rawList.length === 0) continue;

      const seenNames = new Set<string>();
      const stations: CachedRadioList['stations'] = [];

      for (const s of rawList) {
        const cleanName = (s.name || '').trim().replace(/\s+/g, ' ');
        const streamUrl = (s.url_resolved || s.url || '').trim();
        if (!cleanName || !streamUrl) continue;
        if (!validateExternalUrl(streamUrl)) continue;
        const nameKey = cleanName.toLocaleLowerCase('tr-TR');
        if (seenNames.has(nameKey)) continue;
        seenNames.add(nameKey);

        stations.push({
          id: `rb_${s.stationuuid}`,
          name: cleanName,
          streamUrl,
          logoUrl: s.favicon && validateExternalUrl(s.favicon) ? s.favicon : null,
          tags: s.tags || '',
          codec: s.codec && s.codec !== 'UNKNOWN' ? s.codec : s.hls ? 'HLS' : 'AUDIO',
          bitrate: s.bitrate || 128,
          country: s.country || (cacheKey === 'tr' ? 'Türkiye' : 'Global'),
        });
      }

      if (stations.length > 0) {
        radioCache.set(cacheKey, { fetchedAt: Date.now(), stations });
        return stations;
      }
    } catch {
      // Try next mirror
    }
  }

  return FALLBACK_TURKISH_RADIOS;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

function normalizeEpgName(raw: string): string {
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

function parseXmltvDate(raw: string): number {
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
  if (!m) return 0;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  let utcMs = Date.UTC(year, month, day, hour, minute, second);
  if (m[7]) {
    const sign = m[7][0] === '-' ? -1 : 1;
    const offH = Number(m[7].slice(1, 3));
    const offM = Number(m[7].slice(3, 5));
    utcMs -= sign * (offH * 60 + offM) * 60 * 1000;
  }
  return utcMs;
}

async function getEpgData(customUrl?: string, forceRefresh = false): Promise<EpgCacheEntry> {
  const targetUrl =
    customUrl && validateExternalUrl(customUrl) ? customUrl.trim() : DEFAULT_EPG_URL;

  const existing = epgCache.get(targetUrl);
  if (!forceRefresh && existing && Date.now() - existing.fetchedAt < EPG_CACHE_TTL_MS) {
    return existing;
  }

  const resp = await fetch(targetUrl, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent': DEFAULT_UA,
      Accept: '*/*',
    },
  });
  if (!resp.ok) {
    throw new Error(`EPG HTTP ${resp.status}`);
  }

  const rawBuf = Buffer.from(await resp.arrayBuffer());
  const isGzip =
    targetUrl.toLowerCase().endsWith('.gz') ||
    (rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b);
  const xmlText = (isGzip ? gunzipSync(rawBuf) : rawBuf).toString('utf-8');

  const idToNorms = new Map<string, string[]>();
  const channelAliases = new Map<string, string>();
  const byNormName = new Map<string, EpgProgramme[]>();

  const channelRegex = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/gi;
  let chMatch: RegExpExecArray | null;
  while ((chMatch = channelRegex.exec(xmlText)) !== null) {
    const chId = decodeXmlEntities(chMatch[1]);
    const inner = chMatch[2];
    const norms = new Set<string>();
    const idNorm = normalizeEpgName(chId);
    if (idNorm) norms.add(idNorm);

    const dnRegex = /<display-name[^>]*>([^<]+)<\/display-name>/gi;
    let dnMatch: RegExpExecArray | null;
    while ((dnMatch = dnRegex.exec(inner)) !== null) {
      const displayName = decodeXmlEntities(dnMatch[1]).trim();
      const norm = normalizeEpgName(displayName);
      if (norm) {
        norms.add(norm);
        if (!channelAliases.has(norm)) {
          channelAliases.set(norm, displayName);
        }
      }
    }
    idToNorms.set(chId, [...norms]);
  }

  // Only retain programmes from 3 hours ago up to +36 hours to keep payload snappy
  const now = Date.now();
  const minWindow = now - 3 * 60 * 60 * 1000;
  const maxWindow = now + 36 * 60 * 60 * 1000;

  const progRegex =
    /<programme\s+start="([^"]+)"\s+stop="([^"]+)"\s+channel="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/gi;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = progRegex.exec(xmlText)) !== null) {
    const startMs = parseXmltvDate(pMatch[1]);
    const stopMs = parseXmltvDate(pMatch[2]);
    if (!startMs || !stopMs || stopMs < minWindow || startMs > maxWindow) {
      continue;
    }

    const chId = decodeXmlEntities(pMatch[3]);
    const body = pMatch[4];
    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue;
    const title = decodeXmlEntities(titleMatch[1]).trim();
    if (!title) continue;

    const descMatch = body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
    const desc = descMatch ? decodeXmlEntities(descMatch[1]).trim() : undefined;

    const prog: EpgProgramme = { channelId: chId, startMs, stopMs, title, desc };
    const norms = idToNorms.get(chId) ?? [normalizeEpgName(chId)];
    for (const norm of norms) {
      if (!norm) continue;
      let list = byNormName.get(norm);
      if (!list) {
        list = [];
        byNormName.set(norm, list);
      }
      list.push(prog);
    }
  }

  for (const list of byNormName.values()) {
    list.sort((a, b) => a.startMs - b.startMs);
  }

  const entry: EpgCacheEntry = {
    fetchedAt: Date.now(),
    sourceUrl: targetUrl,
    byNormName,
    channelAliases,
  };
  epgCache.set(targetUrl, entry);
  return entry;
}

function findProgrammesForChannelName(
  entry: EpgCacheEntry,
  channelName: string
): EpgProgramme[] | undefined {
  const norm = normalizeEpgName(channelName);
  if (!norm) return undefined;
  const direct = entry.byNormName.get(norm);
  if (direct) return direct;

  // Common Turkish IPTV suffixes like "TV" omitted/added (e.g. "SHOW" vs "SHOWTV", "STAR" vs "STARTV")
  const withTv = entry.byNormName.get(`${norm}TV`);
  if (withTv) return withTv;
  if (norm.endsWith('TV')) {
    const withoutTv = entry.byNormName.get(norm.slice(0, -2));
    if (withoutTv) return withoutTv;
  }
  return undefined;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Default bundled playlist endpoint (cached in memory)
  app.get('/api/playlist/default', async (_req: Request, res: Response) => {
    try {
      if (defaultPlaylistCache) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.send(defaultPlaylistCache);
      }
      const candidates = [
        path.resolve(__dirname, 'public', 'playlist.m3u8'),
        path.resolve(__dirname, 'dist', 'playlist.m3u8'),
      ];
      for (const filePath of candidates) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          defaultPlaylistCache = content;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=60');
          return res.send(content);
        } catch {
          // Try next candidate
        }
      }
      return res.status(404).json({ error: 'Varsayılan liste bulunamadı.' });
    } catch {
      return res.status(500).json({ error: 'Liste okunamadı.' });
    }
  });

  // Online XMLTV EPG: Now & Next summary map for all channels
  app.get('/api/epg/now', async (req: Request, res: Response) => {
    const customUrl = typeof req.query.url === 'string' ? req.query.url : undefined;
    const forceRefresh = req.query.refresh === '1';
    try {
      const entry = await getEpgData(customUrl, forceRefresh);
      const now = Date.now();
      const map: Record<
        string,
        {
          now: { title: string; startMs: number; stopMs: number; desc?: string } | null;
          next: { title: string; startMs: number; stopMs: number } | null;
        }
      > = {};

      for (const [normKey, list] of entry.byNormName.entries()) {
        let currentProg: EpgProgramme | null = null;
        let nextProg: EpgProgramme | null = null;
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          if (p.startMs <= now && p.stopMs > now) {
            currentProg = p;
            nextProg = list[i + 1] ?? null;
            break;
          }
          if (p.startMs > now && !nextProg) {
            nextProg = p;
            break;
          }
        }
        if (currentProg || nextProg) {
          map[normKey] = {
            now: currentProg
              ? {
                  title: currentProg.title,
                  startMs: currentProg.startMs,
                  stopMs: currentProg.stopMs,
                  desc: currentProg.desc,
                }
              : null,
            next: nextProg
              ? {
                  title: nextProg.title,
                  startMs: nextProg.startMs,
                  stopMs: nextProg.stopMs,
                }
              : null,
          };
        }
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        channels: map,
        channelCount: Object.keys(map).length,
        sourceUrl: entry.sourceUrl,
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
      });
    } catch {
      return res.status(502).json({
        error: 'Online EPG verisi alınamadı.',
        channels: {},
        channelCount: 0,
      });
    }
  });

  // Online XMLTV EPG: Full schedule for a specific channel name
  app.get('/api/epg/channel', async (req: Request, res: Response) => {
    const channelName = typeof req.query.name === 'string' ? req.query.name : '';
    const customUrl = typeof req.query.url === 'string' ? req.query.url : undefined;
    if (!channelName.trim()) {
      return res.json({ programmes: [] });
    }
    try {
      const entry = await getEpgData(customUrl, false);
      const list = findProgrammesForChannelName(entry, channelName) ?? [];
      const now = Date.now();
      const upcoming = list.filter((p) => p.stopMs > now - 30 * 60 * 1000).slice(0, 30);
      return res.json({
        programmes: upcoming.map((p) => ({
          title: p.title,
          startMs: p.startMs,
          stopMs: p.stopMs,
          desc: p.desc,
        })),
      });
    } catch {
      return res.json({ programmes: [] });
    }
  });

  // Live online radio directory endpoint
  app.get('/api/radios/online', async (req: Request, res: Response) => {
    const scope = req.query.scope === 'global' ? 'global' : 'tr';
    const forceRefresh = req.query.refresh === '1';
    if (forceRefresh) {
      radioCache.delete(scope);
    }
    try {
      const stations = await fetchOnlineRadios(scope);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ stations, count: stations.length });
    } catch {
      return res.json({
        stations: FALLBACK_TURKISH_RADIOS,
        count: FALLBACK_TURKISH_RADIOS.length,
      });
    }
  });

  // Normalize GitHub blob/gist links into raw fetchable URLs
  function normalizeGithubSourceUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    const blobMatch = trimmed.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i
    );
    if (blobMatch) {
      return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}/${blobMatch[4]}`;
    }
    const gistMatch = trimmed.match(
      /^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)\/?$/i
    );
    if (gistMatch) {
      return `https://gist.githubusercontent.com/${gistMatch[1]}/${gistMatch[2]}/raw`;
    }
    return trimmed;
  }

  function convertJsonPlaylistToM3u(
    rawText: string
  ): { content: string; count: number } | null {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      const lines: string[] = ['#EXTM3U'];
      let count = 0;

      const pushEntry = (item: Record<string, unknown>, fallbackGroup?: string) => {
        const rawStream =
          item.url ??
          item.streamUrl ??
          item.stream_url ??
          item.stream ??
          item.link ??
          item.source ??
          item.file ??
          item.m3u8;
        const streamUrl = typeof rawStream === 'string' ? rawStream.trim() : '';
        if (!streamUrl || (!streamUrl.startsWith('http://') && !streamUrl.startsWith('https://'))) {
          return;
        }
        const rawName =
          item.name ??
          item.title ??
          item.kanal ??
          item.channel ??
          item.tvg_name ??
          item.label;
        const name =
          typeof rawName === 'string' && rawName.trim()
            ? rawName.trim().replace(/[\r\n]+/g, ' ')
            : `Kanal ${count + 1}`;
        const rawGroup =
          item.group ??
          item.category ??
          item.category_name ??
          item.kategori ??
          item.group_title ??
          fallbackGroup ??
          'Genel';
        const group =
          typeof rawGroup === 'string' && rawGroup.trim()
            ? rawGroup.trim().replace(/"/g, '')
            : 'Genel';
        const rawLogo =
          item.logo ??
          item.logoUrl ??
          item.logo_url ??
          item.tvg_logo ??
          item.icon ??
          item.image ??
          '';
        const logo =
          typeof rawLogo === 'string' && rawLogo.trim().startsWith('http')
            ? rawLogo.trim().replace(/"/g, '')
            : '';
        const logoAttr = logo ? ` tvg-logo="${logo}"` : '';

        const ua = typeof item.userAgent === 'string' ? item.userAgent.trim() : '';
        const ref = typeof item.referer === 'string' ? item.referer.trim() : '';

        lines.push(
          `#EXTINF:-1 tvg-name="${name.replace(/"/g, '')}"${logoAttr} group-title="${group}",${name}`
        );
        if (ua) lines.push(`#EXTVLCOPT:http-user-agent=${ua}`);
        if (ref) lines.push(`#EXTVLCOPT:http-referrer=${ref}`);
        lines.push(streamUrl);
        count++;
      };

      const walkList = (arr: unknown[], fallbackGroup?: string) => {
        for (const el of arr) {
          if (el && typeof el === 'object' && !Array.isArray(el)) {
            pushEntry(el as Record<string, unknown>, fallbackGroup);
          }
        }
      };

      if (Array.isArray(parsed)) {
        walkList(parsed);
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const listKeys = [
          'channels',
          'live_channels',
          'list',
          'items',
          'streams',
          'data',
          'playlist',
        ];
        let handled = false;
        for (const key of listKeys) {
          if (Array.isArray(obj[key])) {
            walkList(obj[key] as unknown[]);
            handled = true;
            break;
          }
        }
        if (!handled) {
          // Grouped object map e.g. { "Spor": [...], "Ulusal": [...] }
          for (const [groupKey, groupVal] of Object.entries(obj)) {
            if (Array.isArray(groupVal)) {
              walkList(groupVal, groupKey);
            }
          }
        }
      }

      if (count === 0) return null;
      return { content: lines.join('\n'), count };
    } catch {
      return null;
    }
  }

  async function fetchRemotePlaylistOrJson(
    rawUrl: string,
    signal?: AbortSignal
  ): Promise<{
    content: string;
    format: 'm3u' | 'json';
    count?: number;
    resolvedUrl: string;
  }> {
    const normalized = normalizeGithubSourceUrl(rawUrl);
    const parsed = validateExternalUrl(normalized);
    if (!parsed) {
      throw new Error('Geçersiz veya desteklenmeyen adres.');
    }

    const upstream = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: signal ?? AbortSignal.timeout(18000),
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: '*/*',
        'Cache-Control': 'no-cache',
      },
    });

    if (!upstream.ok) {
      throw new Error(`HTTP ${upstream.status}`);
    }

    const content = await upstream.text();
    const trimmed = content.trimStart();
    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const looksLikeJson =
      contentType.includes('json') ||
      parsed.pathname.toLowerCase().endsWith('.json') ||
      trimmed.startsWith('{') ||
      trimmed.startsWith('[');

    if (looksLikeJson) {
      const converted = convertJsonPlaylistToM3u(content);
      if (!converted) {
        throw new Error('JSON dosyası içinde geçerli yayın kanalı bulunamadı.');
      }
      return {
        content: converted.content,
        format: 'json',
        count: converted.count,
        resolvedUrl: parsed.toString(),
      };
    }

    if (!content.includes('#EXTM3U') && !content.includes('#EXTINF')) {
      throw new Error('Geçersiz M3U veya JSON formatı.');
    }

    return {
      content,
      format: 'm3u',
      resolvedUrl: parsed.toString(),
    };
  }

  // Fetch & validate remote M3U/M3U8 or GitHub JSON playlist (mandatory auto-update & manual import)
  app.get('/api/playlist/import', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    req.on('close', () => controller.abort());

    try {
      const result = await fetchRemotePlaylistOrJson(rawUrl, controller.signal);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        content: result.content,
        format: result.format,
        count: result.count,
        resolvedUrl: result.resolvedUrl,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'AbortError'
          ? 'Bağlantı zaman aşımına uğradı.'
          : err instanceof Error
          ? err.message
          : 'Liste indirilemedi.';
      const status = msg.includes('Geçersiz') ? 400 : 502;
      return res.status(status).json({ error: msg });
    } finally {
      clearTimeout(timeout);
    }
  });

  // Bulk fetch & sync multiple GitHub JSON / M3U playlists concurrently
  app.post('/api/playlist/import-bulk', async (req: Request, res: Response) => {
    const rawUrls: unknown[] = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const urls: string[] = rawUrls
      .filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0)
      .slice(0, 15);

    if (urls.length === 0) {
      return res.status(400).json({ error: 'En az bir geçerli M3U veya GitHub JSON adresi gereklidir.' });
    }

    const settled = await Promise.allSettled(
      urls.map((u: string) => fetchRemotePlaylistOrJson(u, AbortSignal.timeout(18000)))
    );

    const results = settled.map((item, idx) => {
      const url = urls[idx];
      if (item.status === 'fulfilled') {
        return {
          url,
          ok: true,
          format: item.value.format,
          count: item.value.count,
          resolvedUrl: item.value.resolvedUrl,
          content: item.value.content,
        };
      }
      return {
        url,
        ok: false,
        error: item.reason instanceof Error ? item.reason.message : 'Liste indirilemedi.',
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      results,
      fetchedAt: new Date().toISOString(),
    });
  });

  // Fetch live channels & categories from an Xtream Codes provider (player_api.php)
  app.post('/api/xtream/channels', async (req: Request, res: Response) => {
    const rawServer = typeof req.body?.server === 'string' ? req.body.server.trim() : '';
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';

    if (!rawServer || !username || !password) {
      return res.status(400).json({ error: 'Sunucu adresi, kullanıcı adı ve şifre gereklidir.' });
    }

    const normalizedServer = rawServer.replace(/\/+$/, '');
    const parsedServer = validateExternalUrl(normalizedServer);
    if (!parsedServer) {
      return res.status(400).json({ error: 'Geçersiz veya desteklenmeyen sunucu adresi.' });
    }

    const baseApi = `${parsedServer.origin}${parsedServer.pathname === '/' ? '' : parsedServer.pathname}/player_api.php`;
    const authParams = new URLSearchParams({ username, password });

    try {
      const catUrl = `${baseApi}?${authParams.toString()}&action=get_live_categories`;
      const streamUrl = `${baseApi}?${authParams.toString()}&action=get_live_streams`;

      const [catResp, streamResp] = await Promise.all([
        fetch(catUrl, {
          signal: AbortSignal.timeout(12000),
          headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
        }).catch(() => null),
        fetch(streamUrl, {
          signal: AbortSignal.timeout(18000),
          headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
        }),
      ]);

      if (!streamResp.ok) {
        return res.status(502).json({ error: `Xtream sunucusu yanıt vermedi (HTTP ${streamResp.status}).` });
      }

      const rawStreams = (await streamResp.json()) as unknown;
      if (!Array.isArray(rawStreams)) {
        return res.status(422).json({ error: 'Xtream kullanıcı adı, şifre veya sunucu bilgileri hatalı.' });
      }

      const categoryMap = new Map<string, string>();
      if (catResp && catResp.ok) {
        const rawCats = (await catResp.json().catch(() => [])) as Array<{
          category_id?: string | number;
          category_name?: string;
        }>;
        if (Array.isArray(rawCats)) {
          for (const c of rawCats) {
            if (c.category_id !== undefined && c.category_name) {
              categoryMap.set(String(c.category_id), String(c.category_name).trim());
            }
          }
        }
      }

      const originBase = `${parsedServer.origin}${parsedServer.pathname === '/' ? '' : parsedServer.pathname}`;
      const lines: string[] = ['#EXTM3U'];

      for (const item of rawStreams as Array<{
        stream_id?: string | number;
        name?: string;
        stream_icon?: string;
        category_id?: string | number;
        stream_type?: string;
      }>) {
        const streamId = item.stream_id;
        const name = (item.name || '').trim();
        if (!streamId || !name) continue;
        const catName =
          (item.category_id !== undefined ? categoryMap.get(String(item.category_id)) : undefined) ||
          'Xtream Canlı';
        const logo = (item.stream_icon || '').trim();
        const logoAttr = logo && validateExternalUrl(logo) ? ` tvg-logo="${logo.replace(/"/g, '')}"` : '';
        const safeGroup = catName.replace(/"/g, '');
        const safeName = name.replace(/[\r\n]+/g, ' ');
        const m3u8Stream = `${originBase}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(String(streamId))}.m3u8`;

        lines.push(`#EXTINF:-1 tvg-name="${safeName.replace(/"/g, '')}"${logoAttr} group-title="${safeGroup}",${safeName}`);
        lines.push(m3u8Stream);
      }

      if (lines.length <= 1) {
        return res.status(422).json({ error: 'Bu Xtream hesabında canlı TV kanalı bulunamadı.' });
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        content: lines.join('\n'),
        count: (lines.length - 1) / 2,
        fetchedAt: new Date().toISOString(),
      });
    } catch {
      return res.status(502).json({ error: 'Xtream sunucusuna bağlanılamadı.' });
    }
  });

  // Fetch Films (VOD) & Series from Xtream Codes provider
  app.post('/api/xtream/vod', async (req: Request, res: Response) => {
    const rawServer = typeof req.body?.server === 'string' ? req.body.server.trim() : '';
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';

    if (!rawServer || !username || !password) {
      return res.status(400).json({ error: 'Sunucu adresi, kullanıcı adı ve şifre gereklidir.' });
    }

    const normalizedServer = rawServer.replace(/\/+$/, '');
    const parsedServer = validateExternalUrl(normalizedServer);
    if (!parsedServer) {
      return res.status(400).json({ error: 'Geçersiz veya desteklenmeyen sunucu adresi.' });
    }

    const originBase = `${parsedServer.origin}${parsedServer.pathname === '/' ? '' : parsedServer.pathname}`;
    const baseApi = `${originBase}/player_api.php`;
    const authParams = new URLSearchParams({ username, password });

    try {
      const [vodCatsResp, vodStreamsResp, seriesCatsResp, seriesResp] = await Promise.all([
        fetch(`${baseApi}?${authParams.toString()}&action=get_vod_categories`, {
          signal: AbortSignal.timeout(12000),
          headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
        }).catch(() => null),
        fetch(`${baseApi}?${authParams.toString()}&action=get_vod_streams`, {
          signal: AbortSignal.timeout(18000),
          headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
        }).catch(() => null),
        fetch(`${baseApi}?${authParams.toString()}&action=get_series_categories`, {
          signal: AbortSignal.timeout(12000),
          headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
        }).catch(() => null),
        fetch(`${baseApi}?${authParams.toString()}&action=get_series`, {
          signal: AbortSignal.timeout(18000),
          headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
        }).catch(() => null),
      ]);

      const vodCategoryMap = new Map<string, string>();
      if (vodCatsResp && vodCatsResp.ok) {
        const rawCats = (await vodCatsResp.json().catch(() => [])) as Array<{
          category_id?: string | number;
          category_name?: string;
        }>;
        if (Array.isArray(rawCats)) {
          for (const c of rawCats) {
            if (c.category_id !== undefined && c.category_name) {
              vodCategoryMap.set(String(c.category_id), String(c.category_name).trim());
            }
          }
        }
      }

      const seriesCategoryMap = new Map<string, string>();
      if (seriesCatsResp && seriesCatsResp.ok) {
        const rawCats = (await seriesCatsResp.json().catch(() => [])) as Array<{
          category_id?: string | number;
          category_name?: string;
        }>;
        if (Array.isArray(rawCats)) {
          for (const c of rawCats) {
            if (c.category_id !== undefined && c.category_name) {
              seriesCategoryMap.set(String(c.category_id), String(c.category_name).trim());
            }
          }
        }
      }

      const lines: string[] = ['#EXTM3U'];
      let movieCount = 0;
      let seriesCount = 0;

      if (vodStreamsResp && vodStreamsResp.ok) {
        const rawMovies = (await vodStreamsResp.json().catch(() => [])) as Array<{
          stream_id?: string | number;
          name?: string;
          stream_icon?: string;
          category_id?: string | number;
          container_extension?: string;
        }>;
        if (Array.isArray(rawMovies)) {
          for (const m of rawMovies) {
            if (!m.stream_id || !m.name) continue;
            const ext = (m.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
            const cat =
              (m.category_id !== undefined ? vodCategoryMap.get(String(m.category_id)) : undefined) ||
              'Filmler';
            const logo = (m.stream_icon || '').trim();
            const logoAttr = logo && validateExternalUrl(logo) ? ` tvg-logo="${logo.replace(/"/g, '')}"` : '';
            const safeName = m.name.replace(/[\r\n]+/g, ' ').trim();
            const url = `${originBase}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(String(m.stream_id))}.${ext}`;
            lines.push(`#EXTINF:-1 tvg-name="${safeName.replace(/"/g, '')}"${logoAttr} group-title="Film · ${cat.replace(/"/g, '')}",${safeName}`);
            lines.push(url);
            movieCount++;
          }
        }
      }

      // Also include series catalog metadata so client can browse & fetch episodes on demand
      const seriesList: Array<{
        seriesId: string;
        name: string;
        posterUrl: string | null;
        category: string;
        rating?: string;
        year?: string;
      }> = [];

      if (seriesResp && seriesResp.ok) {
        const rawSeries = (await seriesResp.json().catch(() => [])) as Array<{
          series_id?: string | number;
          name?: string;
          cover?: string;
          category_id?: string | number;
          rating?: string | number;
          releaseDate?: string;
        }>;
        if (Array.isArray(rawSeries)) {
          for (const s of rawSeries) {
            if (!s.series_id || !s.name) continue;
            const cat =
              (s.category_id !== undefined ? seriesCategoryMap.get(String(s.category_id)) : undefined) ||
              'Diziler';
            const poster = (s.cover || '').trim();
            seriesList.push({
              seriesId: String(s.series_id),
              name: s.name.trim(),
              posterUrl: poster && validateExternalUrl(poster) ? poster : null,
              category: cat,
              rating: s.rating ? String(s.rating) : undefined,
              year: s.releaseDate ? String(s.releaseDate).slice(0, 4) : undefined,
            });
            seriesCount++;
          }
        }
      }

      if (movieCount === 0 && seriesCount === 0) {
        return res.status(422).json({ error: 'Bu Xtream hesabında film veya dizi bulunamadı.' });
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        content: lines.join('\n'),
        movieCount,
        seriesCount,
        series: seriesList,
        xtreamAuth: { server: originBase, username, password },
        fetchedAt: new Date().toISOString(),
      });
    } catch {
      return res.status(502).json({ error: 'Xtream Film/Dizi verisi alınamadı.' });
    }
  });

  // Fetch seasons & episodes for an Xtream series
  app.post('/api/xtream/series-episodes', async (req: Request, res: Response) => {
    const rawServer = typeof req.body?.server === 'string' ? req.body.server.trim() : '';
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    const seriesId = typeof req.body?.seriesId === 'string' ? req.body.seriesId.trim() : '';

    const parsedServer = validateExternalUrl(rawServer.replace(/\/+$/, ''));
    if (!parsedServer || !username || !password || !seriesId) {
      return res.status(400).json({ error: 'Eksik Xtream dizi bilgisi.' });
    }

    const originBase = `${parsedServer.origin}${parsedServer.pathname === '/' ? '' : parsedServer.pathname}`;
    const apiUrl = `${originBase}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_info&series_id=${encodeURIComponent(seriesId)}`;

    try {
      const resp = await fetch(apiUrl, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
      });
      if (!resp.ok) {
        return res.status(502).json({ error: `HTTP ${resp.status}` });
      }
      const data = (await resp.json()) as {
        episodes?: Record<
          string,
          Array<{
            id?: string | number;
            episode_num?: string | number;
            title?: string;
            container_extension?: string;
            season?: string | number;
          }>
        >;
      };
      const episodes: Array<{
        id: string;
        season: number;
        episodeNum: number;
        title: string;
        streamUrl: string;
      }> = [];

      if (data.episodes && typeof data.episodes === 'object') {
        for (const [seasonKey, list] of Object.entries(data.episodes)) {
          if (!Array.isArray(list)) continue;
          for (const ep of list) {
            if (!ep.id) continue;
            const ext = (ep.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
            const seasonNum = Number(ep.season ?? seasonKey) || 1;
            const epNum = Number(ep.episode_num) || 1;
            episodes.push({
              id: String(ep.id),
              season: seasonNum,
              episodeNum: epNum,
              title: (ep.title || `Sezon ${seasonNum} Bölüm ${epNum}`).trim(),
              streamUrl: `${originBase}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(String(ep.id))}.${ext}`,
            });
          }
        }
      }

      episodes.sort((a, b) => a.season - b.season || a.episodeNum - b.episodeNum);
      return res.json({ episodes });
    } catch {
      return res.status(502).json({ error: 'Dizi bölümleri alınamadı.' });
    }
  });

  // Stream proxy with singleflight coalescing & bounded LRU edge cache for HLS manifests/segments
  app.get('/api/stream', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const ua = typeof req.query.ua === 'string' && req.query.ua ? req.query.ua : DEFAULT_UA;
    const referer = typeof req.query.referer === 'string' ? req.query.referer : '';
    const origin = typeof req.query.origin === 'string' ? req.query.origin : '';

    const parsed = validateExternalUrl(rawUrl);
    if (!parsed) {
      return res.status(400).send('Invalid stream URL');
    }

    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : '';
    const lowerUrl = parsed.toString().toLowerCase();
    const isFiniteHlsResource =
      !rangeHeader &&
      (/\.(m3u8|m3u|ts|m4s|aac|key)(\?|$)/i.test(lowerUrl) ||
        lowerUrl.includes('/hls/') ||
        lowerUrl.includes('workers.dev/play'));

    const cacheKey = `${parsed.toString()}|${ua}|${referer}|${origin}`;

    if (isFiniteHlsResource) {
      const cached = getHlsCacheEntry(cacheKey);
      if (cached) {
        res.status(cached.status);
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader(
          'Cache-Control',
          cached.isPlaylist ? 'public, max-age=1' : 'public, max-age=15'
        );
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.send(cached.body);
      }

      // Singleflight: coalesce concurrent viewers requesting the same manifest or segment
      let pending = inFlightHls.get(cacheKey);
      if (!pending) {
        pending = (async (): Promise<CachedHlsResponse> => {
          const headers: Record<string, string> = {
            'User-Agent': ua,
            Accept: '*/*',
          };
          if (referer) headers['Referer'] = referer;
          if (origin) headers['Origin'] = origin;

          const upstream = await fetch(parsed.toString(), {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(20000),
            headers,
          });

          if (!upstream.ok) {
            throw new Error(`UPSTREAM_${upstream.status}`);
          }

          const finalUrl = upstream.url || parsed.toString();
          const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
          const isPlaylistByHeader =
            contentType.includes('mpegurl') ||
            contentType.includes('m3u8') ||
            contentType.includes('vnd.apple');
          const isPlaylistByUrl =
            finalUrl.toLowerCase().includes('.m3u8') ||
            finalUrl.toLowerCase().endsWith('.m3u');

          const rawBuffer = Buffer.from(await upstream.arrayBuffer());
          const head = rawBuffer.subarray(0, 64).toString('utf-8').trimStart();
          const isPlaylist =
            isPlaylistByHeader || isPlaylistByUrl || head.startsWith('#EXTM3U');

          if (isPlaylist) {
            const text = rawBuffer.toString('utf-8');
            if (text.trimStart().startsWith('#EXTM3U') || text.includes('#EXTINF')) {
              const rewritten = rewriteM3u8Content(text, finalUrl, ua, referer, origin);
              const entry: CachedHlsResponse = {
                status: 200,
                contentType: 'application/vnd.apple.mpegurl; charset=utf-8',
                body: Buffer.from(rewritten, 'utf-8'),
                isPlaylist: true,
                expiresAt: Date.now() + 1500, // 1.5s live manifest coalescing
              };
              setHlsCacheEntry(cacheKey, entry);
              return entry;
            }
          }

          const entry: CachedHlsResponse = {
            status: upstream.status,
            contentType: contentType || 'video/mp2t',
            body: rawBuffer,
            isPlaylist: false,
            expiresAt: Date.now() + 20000, // 20s immutable HLS segment cache
          };
          setHlsCacheEntry(cacheKey, entry);
          return entry;
        })().finally(() => {
          inFlightHls.delete(cacheKey);
        });
        inFlightHls.set(cacheKey, pending);
      }

      try {
        const result = await pending;
        res.status(result.status);
        res.setHeader('Content-Type', result.contentType);
        res.setHeader(
          'Cache-Control',
          result.isPlaylist ? 'public, max-age=1' : 'public, max-age=15'
        );
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.send(result.body);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        const statusMatch = msg.match(/^UPSTREAM_(\d{3})$/);
        if (statusMatch) {
          return res.status(Number(statusMatch[1])).send(`Upstream error ${statusMatch[1]}`);
        }
        return res.status(502).send('Stream proxy error');
      }
    }

    // Continuous live radio / range / non-HLS streams -> direct streaming pipe
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    req.on('close', () => controller.abort());

    const headers: Record<string, string> = {
      'User-Agent': ua,
      Accept: '*/*',
    };
    if (referer) headers['Referer'] = referer;
    if (origin) headers['Origin'] = origin;
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
    }

    try {
      let upstream = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers,
      });

      clearTimeout(timeout);

      if (!upstream.ok && upstream.status !== 206) {
        return res.status(upstream.status).send(`Upstream error ${upstream.status}`);
      }

      let finalUrl = upstream.url || parsed.toString();
      let contentType = (upstream.headers.get('content-type') || '').toLowerCase();

      // Handle Shoutcast .pls playlist files transparently
      if (
        contentType.includes('scpls') ||
        finalUrl.toLowerCase().endsWith('.pls')
      ) {
        const plsText = await upstream.text();
        const resolvedAudioUrl = extractPlsUrl(plsText);
        if (resolvedAudioUrl && validateExternalUrl(resolvedAudioUrl)) {
          upstream = await fetch(resolvedAudioUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers,
          });
          if (!upstream.ok && upstream.status !== 206) {
            return res.status(upstream.status).send(`Upstream error ${upstream.status}`);
          }
          finalUrl = upstream.url || resolvedAudioUrl;
          contentType = (upstream.headers.get('content-type') || '').toLowerCase();
        }
      }

      res.status(upstream.status);
      if (contentType) res.setHeader('Content-Type', contentType);
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      const acceptRanges = upstream.headers.get('accept-ranges');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');

      if (!upstream.body) {
        return res.end();
      }

      const nodeStream = Readable.fromWeb(
        upstream.body as unknown as import('node:stream/web').ReadableStream
      );
      nodeStream.on('error', () => {
        if (!res.headersSent) {
          res.status(502).end();
        } else {
          res.end();
        }
      });
      return nodeStream.pipe(res);
    } catch {
      clearTimeout(timeout);
      if (!res.headersSent) {
        return res.status(502).send('Stream proxy error');
      }
      return res.end();
    }
  });

  // Proxy channel logos cleanly
  app.get('/api/logo', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const parsed = validateExternalUrl(rawUrl);
    if (!parsed) {
      return res.status(400).end();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const upstream = await fetch(parsed.toString(), {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: 'image/*,*/*;q=0.8',
        },
      });
      if (!upstream.ok || !upstream.body) {
        return res.status(404).end();
      }
      const ct = upstream.headers.get('content-type') || 'image/png';
      if (!ct.startsWith('image/')) {
        return res.status(404).end();
      }
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const nodeStream = Readable.fromWeb(
        upstream.body as unknown as import('node:stream/web').ReadableStream
      );
      return nodeStream.pipe(res);
    } catch {
      return res.status(404).end();
    } finally {
      clearTimeout(timeout);
    }
  });

  // Export updated playlist.m3u8 (TV + Online Radios + EPG header)
  app.get('/api/export/playlist.m3u8', async (_req: Request, res: Response) => {
    try {
      let baseContent = defaultPlaylistCache || '';
      if (!baseContent) {
        const candidates = [
          path.resolve(__dirname, 'public', 'playlist.m3u8'),
          path.resolve(__dirname, 'dist', 'playlist.m3u8'),
        ];
        for (const filePath of candidates) {
          try {
            baseContent = await fs.readFile(filePath, 'utf-8');
            defaultPlaylistCache = baseContent;
            break;
          } catch {
            // Try next
          }
        }
      }

      const radios = await fetchOnlineRadios('tr').catch(() => FALLBACK_TURKISH_RADIOS);

      const headerInjected = baseContent.startsWith('#EXTM3U')
        ? baseContent.replace(
            /^#EXTM3U[^\r\n]*/,
            `#EXTM3U url-tvg="${DEFAULT_EPG_URL}" x-tvg-url="${DEFAULT_EPG_URL}"`
          )
        : `#EXTM3U url-tvg="${DEFAULT_EPG_URL}"\n${baseContent}`;

      const radioEntries = radios
        .map((r) => {
          const logoAttr = r.logoUrl ? ` tvg-logo="${r.logoUrl}"` : '';
          return `#EXTINF:-1 tvg-name="${r.name.replace(/"/g, '')}"${logoAttr} group-title="Radyo & Müzik",${r.name}\n${r.streamUrl}`;
        })
        .join('\n');

      const combined = `${headerInjected.trimEnd()}\n${radioEntries}\n`;
      res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u8"');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(combined);
    } catch {
      return res.status(500).json({ error: 'Liste dışa aktarılamadı.' });
    }
  });

  // Download sample GitHub JSON playlist template
  app.get('/api/export/sample-list.json', async (_req: Request, res: Response) => {
    try {
      const filePath = path.resolve(__dirname, 'public', 'lists', 'ornek-github-liste.json');
      const content = await fs.readFile(filePath, 'utf-8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="ornek-github-liste.json"'
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.send(content);
    } catch {
      return res.status(404).json({ error: 'Örnek JSON şablonu bulunamadı.' });
    }
  });

  // Export clean source code archive (.tar.gz) without node_modules/dist
  app.get('/api/export/source.tar.gz', async (_req: Request, res: Response) => {
    try {
      const filesToPack: Array<{ relPath: string; data: Buffer }> = [];

      const rootFiles = [
        'package.json',
        'index.html',
        'metadata.json',
        'tsconfig.json',
        'vite.config.ts',
        'server.ts',
        '.env.example',
        '.github/workflows/main.yml',
        'public/playlist.m3u8',
        'public/lists/ornek-github-liste.json',
      ];

      for (const rel of rootFiles) {
        try {
          const data = await fs.readFile(path.resolve(__dirname, rel));
          filesToPack.push({ relPath: rel, data });
        } catch {
          // Skip missing optional file
        }
      }

      async function walkSrc(dir: string, prefix: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          const rel = `${prefix}/${entry.name}`;
          if (entry.isDirectory()) {
            await walkSrc(full, rel);
          } else if (entry.isFile()) {
            const data = await fs.readFile(full);
            filesToPack.push({ relPath: rel, data });
          }
        }
      }

      await walkSrc(path.resolve(__dirname, 'src'), 'src');

      const blocks: Buffer[] = [];
      for (const item of filesToPack) {
        const header = Buffer.alloc(512, 0);
        const nameBytes = Buffer.from(item.relPath, 'utf-8');
        nameBytes.copy(header, 0, 0, Math.min(nameBytes.length, 100));
        Buffer.from('0000644\0', 'ascii').copy(header, 100);
        Buffer.from('0000000\0', 'ascii').copy(header, 108);
        Buffer.from('0000000\0', 'ascii').copy(header, 116);
        Buffer.from(item.data.length.toString(8).padStart(11, '0') + '\0', 'ascii').copy(
          header,
          124
        );
        const mtime = Math.floor(Date.now() / 1000)
          .toString(8)
          .padStart(11, '0');
        Buffer.from(`${mtime}\0`, 'ascii').copy(header, 136);
        Buffer.from('        ', 'ascii').copy(header, 148);
        header[156] = '0'.charCodeAt(0);
        Buffer.from('ustar\0', 'ascii').copy(header, 257);
        Buffer.from('00', 'ascii').copy(header, 263);

        let checksum = 0;
        for (let i = 0; i < 512; i++) checksum += header[i];
        Buffer.from(checksum.toString(8).padStart(6, '0') + '\0 ', 'ascii').copy(
          header,
          148
        );

        blocks.push(header);
        blocks.push(item.data);
        const rem = item.data.length % 512;
        if (rem !== 0) {
          blocks.push(Buffer.alloc(512 - rem, 0));
        }
      }
      blocks.push(Buffer.alloc(1024, 0));

      const gzipped = gzipSync(Buffer.concat(blocks));
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="eymen-tv-radyo-kaynak.tar.gz"'
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.send(gzipped);
    } catch {
      return res.status(500).json({ error: 'Kaynak arşivi oluşturulamadı.' });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Eymen TV & Radyo running on http://${HOST}:${PORT}`);
  });
}

startServer();
