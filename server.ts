import express, { type Request, type Response } from 'express';
import { Readable } from 'node:stream';
import { deflateRawSync, gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

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
  channelLogos: Map<string, string>;
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
let activePrefetchCount = 0;
const MAX_CONCURRENT_PREFETCH = 4;

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

function prefetchHlsSegments(
  playlistText: string,
  baseUrl: string,
  ua: string,
  referer: string,
  origin: string
) {
  // Only prefetch media playlists (skip master variant playlists)
  if (playlistText.includes('#EXT-X-STREAM-INF')) return;
  const lines = playlistText.split(/\r?\n/);
  const segmentUrls: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      const resolved = new URL(line, baseUrl).toString();
      if (validateExternalUrl(resolved)) {
        segmentUrls.push(resolved);
      }
    } catch {
      // ignore invalid segment line
    }
  }
  if (segmentUrls.length === 0) return;

  // Warm the last 2 upcoming live segments (or first 2 for VOD) into hlsCache
  const targets =
    segmentUrls.length > 3
      ? [segmentUrls[segmentUrls.length - 2], segmentUrls[segmentUrls.length - 1]]
      : segmentUrls.slice(0, 2);

  for (const segUrl of targets) {
    if (activePrefetchCount >= MAX_CONCURRENT_PREFETCH) break;
    const segKey = `${segUrl}|${ua}|${referer}|${origin}`;
    if (getHlsCacheEntry(segKey) || inFlightHls.has(segKey)) continue;

    activePrefetchCount++;
    const headers: Record<string, string> = {
      'User-Agent': ua,
      Accept: '*/*',
    };
    if (referer) headers['Referer'] = referer;
    if (origin) headers['Origin'] = origin;

    const task = (async (): Promise<CachedHlsResponse> => {
      const upstream = await fetch(segUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers,
      });
      if (!upstream.ok) {
        throw new Error(`PREFETCH_${upstream.status}`);
      }
      const rawBuffer = Buffer.from(await upstream.arrayBuffer());
      const contentType = (upstream.headers.get('content-type') || 'video/mp2t').toLowerCase();
      const entry: CachedHlsResponse = {
        status: upstream.status,
        contentType,
        body: rawBuffer,
        isPlaylist: false,
        expiresAt: Date.now() + 25000,
      };
      setHlsCacheEntry(segKey, entry);
      return entry;
    })()
      .catch(() => null as unknown as CachedHlsResponse)
      .finally(() => {
        activePrefetchCount = Math.max(0, activePrefetchCount - 1);
        inFlightHls.delete(segKey);
      });

    inFlightHls.set(segKey, task);
  }
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

const FALLBACK_KURDISH_RADIOS: CachedRadioList['stations'] = [
  {
    id: 'ku_trt_radyo_kurdi',
    name: 'TRT Radyo Kurdî',
    streamUrl: 'https://radio-trtradyo6.medya.trt.com.tr/master.m3u8',
    logoUrl: null,
    tags: 'kurdish,trt,news,music',
    codec: 'AAC',
    bitrate: 140,
    country: 'Türkiye',
  },
  {
    id: 'ku_havin_fm',
    name: 'Havin FM',
    streamUrl: 'http://yayin6.radyohizmeti.com:7050/;stream.mp3',
    logoUrl: null,
    tags: 'kurdish,folk music,stran',
    codec: 'MP3',
    bitrate: 64,
    country: 'Türkiye',
  },
  {
    id: 'ku_azadi_fm',
    name: 'Azadi FM (Amed)',
    streamUrl: 'https://amed.ozelip.com/8040/;',
    logoUrl: null,
    tags: 'kurdish,music,amed',
    codec: 'MP3',
    bitrate: 64,
    country: 'Türkiye',
  },
  {
    id: 'ku_kurdistan24',
    name: 'Kurdistan 24 Radyo',
    streamUrl: 'https://audio-edge-3mayu.fra.h.radiomast.io/04b1ce4c-24f2-4172-b756-065832ef78bf',
    logoUrl: null,
    tags: 'kurdish,news,talk',
    codec: 'MP3',
    bitrate: 128,
    country: 'Kurdistan',
  },
  {
    id: 'ku_sirvan_perwer',
    name: 'Radyo Şirvan Perwer',
    streamUrl: 'https://stream-156.zeno.fm/x0xhw6c6g2zuv?zs=AfL9IRdsQ_qHIebZBo-9GA',
    logoUrl: null,
    tags: 'kurdish,folk,music',
    codec: 'MP3',
    bitrate: 128,
    country: 'Kürtçe',
  },
  {
    id: 'ku_speda_radio',
    name: 'Speda Radio',
    streamUrl: 'https://radio.host247.net/spedafm',
    logoUrl: null,
    tags: 'kurdish,news,talk',
    codec: 'MP3',
    bitrate: 128,
    country: 'Kürtçe',
  },
  {
    id: 'ku_denge_cudi',
    name: 'Denge Cudi',
    streamUrl: 'https://denge-cudi.stream.laut.fm/denge-cudi',
    logoUrl: null,
    tags: 'kurdish,music',
    codec: 'MP3',
    bitrate: 128,
    country: 'Kürtçe',
  },
  {
    id: 'ku_govend_radyo',
    name: 'Govend Radyo',
    streamUrl: 'https://stream-56.zeno.fm/xzzu8kynq2zuv?zs=nZP7ZCRXQPOpDFenayr0bQ',
    logoUrl: null,
    tags: 'kurdish,govend,halay,music',
    codec: 'MP3',
    bitrate: 128,
    country: 'Türkiye',
  },
  {
    id: 'ku_axa_rojava',
    name: 'Axa Rojava',
    streamUrl: 'https://stream.zeno.fm/h6mn2c8ha8zuv',
    logoUrl: null,
    tags: 'kurdish,music',
    codec: 'MP3',
    bitrate: 128,
    country: 'Kürtçe',
  },
  {
    id: 'ku_kurd1_radyo',
    name: 'Kurd1 Radyo',
    streamUrl: 'https://listen.radioking.com/radio/119251/stream/158701',
    logoUrl: null,
    tags: 'kurdish,folk,songs',
    codec: 'MP3',
    bitrate: 128,
    country: 'Kürtçe',
  },
  {
    id: 'ku_halkin_sesi',
    name: 'Halkın Sesi Radyo',
    streamUrl: 'https://halkinse.80.yayin.com.tr/;',
    logoUrl: null,
    tags: 'kurdish,folk,protest',
    codec: 'MP3',
    bitrate: 64,
    country: 'Türkiye',
  },
  {
    id: 'ku_mezopotamya',
    name: 'Radyo Mezopotamya',
    streamUrl: 'https://anadolu.liderhost.com.tr/9404/stream',
    logoUrl: null,
    tags: 'kurdish,music',
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
  origin?: string,
  isHlsSegment = false
): string {
  const params = new URLSearchParams();
  params.set('url', targetUrl);
  if (ua) params.set('ua', ua);
  if (referer) params.set('referer', referer);
  if (origin) params.set('origin', origin);
  if (isHlsSegment) params.set('hlsseg', '1');
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
            const isSubPlaylist = resolved.toLowerCase().includes('.m3u8');
            return `URI="${buildProxyUrl(resolved, ua, referer, origin, !isSubPlaylist)}"`;
          } catch {
            return `URI="${uriValue}"`;
          }
        });
      }
      return rawLine;
    }

    try {
      const resolved = new URL(line, baseUrl).toString();
      const lowerRes = resolved.toLowerCase().split('?')[0];
      const isSubPlaylist = lowerRes.endsWith('.m3u8') || lowerRes.endsWith('.m3u') || resolved.toLowerCase().includes('.m3u8');
      return buildProxyUrl(resolved, ua, referer, origin, !isSubPlaylist);
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
  const cacheKey =
    scope === 'global' ? 'global' : scope === 'kurdish' ? 'kurdish' : 'tr';
  const cached = radioCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < RADIO_CACHE_TTL_MS) {
    return cached.stations;
  }

  const endpointPath =
    cacheKey === 'global'
      ? '/json/stations/topclick/80?hidebroken=true'
      : cacheKey === 'kurdish'
      ? '/json/stations/bylanguage/kurdish?limit=80&order=clickcount&reverse=true&hidebroken=true'
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

      if (cacheKey === 'kurdish') {
        for (const fb of FALLBACK_KURDISH_RADIOS) {
          seenNames.add(fb.name.toLocaleLowerCase('tr-TR'));
          stations.push(fb);
        }
      }

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
          tags: s.tags || (cacheKey === 'kurdish' ? 'kurdish' : ''),
          codec: s.codec && s.codec !== 'UNKNOWN' ? s.codec : s.hls ? 'HLS' : 'AUDIO',
          bitrate: s.bitrate || 128,
          country:
            s.country ||
            (cacheKey === 'tr' ? 'Türkiye' : cacheKey === 'kurdish' ? 'Kürtçe' : 'Global'),
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

  return cacheKey === 'kurdish' ? FALLBACK_KURDISH_RADIOS : FALLBACK_TURKISH_RADIOS;
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
  const channelLogos = new Map<string, string>();
  const byNormName = new Map<string, EpgProgramme[]>();

  const channelRegex = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/gi;
  let chMatch: RegExpExecArray | null;
  while ((chMatch = channelRegex.exec(xmlText)) !== null) {
    const chId = decodeXmlEntities(chMatch[1]);
    const inner = chMatch[2];
    const norms = new Set<string>();
    const idNorm = normalizeEpgName(chId);
    if (idNorm) norms.add(idNorm);

    const iconMatch = inner.match(/<icon[^>]+src="([^"]+)"/i);
    const iconUrl = iconMatch ? decodeXmlEntities(iconMatch[1]).trim() : '';

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
    if (iconUrl && validateExternalUrl(iconUrl)) {
      for (const n of norms) {
        if (!channelLogos.has(n)) {
          channelLogos.set(n, iconUrl);
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
    channelLogos,
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

// ---------- Automatic Channel & Radio Logo Directory & Resolver ----------
interface LogoDirectory {
  fetchedAt: number;
  trMap: Map<string, string[]>;
  globalMap: Map<string, string[]>;
  trEntries: Array<{ key: string; urls: string[] }>;
}

const LOGO_DIR_TTL_MS = 6 * 60 * 60 * 1000;
let logoDirectoryCache: LogoDirectory | null = null;
let logoDirectoryPromise: Promise<LogoDirectory> | null = null;

interface CachedLogoImage {
  contentType: string;
  body: Buffer;
  expiresAt: number;
}
const logoImageCache = new Map<string, CachedLogoImage>();
const MAX_LOGO_IMAGE_CACHE_ITEMS = 450;

function isDeadOrBlockedLogoUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return true;
  const parsed = validateExternalUrl(rawUrl);
  if (!parsed) return true;
  const host = parsed.hostname.toLowerCase();
  return (
    host === 'logo.huhu.to' ||
    host.endsWith('.huhu.to') ||
    host.includes('wikia.nocookie.net')
  );
}

function normalizeChannelKeyForLogo(raw: string): string {
  let s = raw
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'C')
    .replace(/Â/g, 'A')
    .replace(/â/g, 'A')
    .replace(/Î/g, 'I')
    .replace(/î/g, 'I')
    .replace(/Û/g, 'U')
    .replace(/û/g, 'U')
    .toUpperCase();

  // Repair garbled Turkish ASCII spacing common in Vavoo / IPTV playlists
  s = s
    .replace(/HABERT\s+RK/g, 'HABERTURK')
    .replace(/BENG\s*T\s+RK/g, 'BENGUTURK')
    .replace(/CNN\s+T\s+RK/g, 'CNNTURK')
    .replace(/DREAM\s+T\s+RK/g, 'DREAMTURK')
    .replace(/T\s+RKHABER/g, 'TURKHABER')
    .replace(/\bLKE\s+TV\b/g, 'ULKETV')
    .replace(/M\s+N\s+KA\s+OCUK/g, 'MINIKACOCUK')
    .replace(/M\s+N\s+KA\s+GO/g, 'MINIKAGO')
    .replace(/M\s+N\s+KA/g, 'MINIKA')
    .replace(/\bOCUK\b/g, 'COCUK')
    .replace(/S\s+NEMA/g, 'SINEMA')
    .replace(/\bA\s+LE\b/g, 'AILE')
    .replace(/AKS\s+YON/g, 'AKSIYON')
    .replace(/\bKOMED\b/g, 'KOMEDI')
    .replace(/\bBE\s+N\b/g, 'BEIN')
    .replace(/\bD\s+Z\b/g, 'DIZI')
    .replace(/\bYERL\b/g, 'YERLI')
    .replace(/\bM\s+Z\s+K\b/g, 'MUZIK')
    .replace(/\bD\s+YANET\b/g, 'DIYANET')
    .replace(/\bG\s+N\s+TV\b/g, 'GUNTV')
    .replace(/\bTRT\s+M\s+Z\s+K\b/g, 'TRTMUZIK')
    .replace(/\bTRT\s+OCUK\b/g, 'TRTCOCUK')
    .replace(/\bTRT\s+T\s+RK\b/g, 'TRTTURK')
    .replace(/\bTRT\s+KURD\b/g, 'TRTKURDI');

  s = s
    .replace(/\.TR$/g, '')
    .replace(/^(4K\s*TR:|HD\s*TR:|TR:|TR\s+|UK:|DE:|US:|FR:|NL:|RU:|AR:|IT:|ES:|KU:|KURD:)/g, '')
    .replace(/\[(TR|DE|UK|US|HD|4K|FHD|VIP)\]/g, ' ')
    .replace(/\((TR|DE|UK|US|HD|4K|FHD|TURKIYE|TURKEY|YEDEK|BACKUP)\)/g, ' ')
    .replace(/\b(4K|UHD|FHD|HD\+?|SD|RAW|HEVC|H265|H264|VIP|BACKUP|YEDEK|TURKEY|TURKIYE)\b/g, ' ')
    .replace(/[^A-Z0-9]/g, '');

  return s;
}

const CURATED_FALLBACK_DOMAINS: Array<[RegExp, string]> = [
  [/KRALFM|KRALPOP/i, 'https://www.google.com/s2/favicons?domain=kralmuzik.com.tr&sz=128'],
  [/JOYTURK|SUPERFM|METROFM|VIRGINRADIO/i, 'https://www.google.com/s2/favicons?domain=karnaval.com&sz=128'],
  [/POWERTURK|POWERPOP|POWERLOVE|POWERFM|POWERDANCE|POWERTV/i, 'https://www.powerapp.com.tr/i/favicov2/apple-icon-120x120.png'],
  [/ALEMFM/i, 'https://www.google.com/s2/favicons?domain=alemfm.com&sz=128'],
  [/BESTFM/i, 'https://www.google.com/s2/favicons?domain=bestfm.com.tr&sz=128'],
  [/FENOMEN/i, 'https://www.google.com/s2/favicons?domain=radyofenomen.com&sz=128'],
  [/KAFARADYO/i, 'https://www.google.com/s2/favicons?domain=kafaradyo.com&sz=128'],
  [/TURKUVAZ|AHABER|ASPOR|ATV|A2|MINIKA/i, 'https://www.google.com/s2/favicons?domain=atv.com.tr&sz=128'],
  [/TRT/i, 'https://www.google.com/s2/favicons?domain=trt.net.tr&sz=128'],
  [/KURDISTAN24/i, 'https://www.google.com/s2/favicons?domain=kurdistan24.net&sz=128'],
  [/RUDAW/i, 'https://www.google.com/s2/favicons?domain=rudaw.net&sz=128'],
  [/KANALD|TEVE2|DREAMTURK|EUROD/i, 'https://www.google.com/s2/favicons?domain=kanald.com.tr&sz=128'],
  [/SHOWTV|SHOWMAX|SHOWTURK|HABERTURK|BLOOMBERG/i, 'https://www.google.com/s2/favicons?domain=showtv.com.tr&sz=128'],
  [/STARTV|EUROSTAR|NTV/i, 'https://www.google.com/s2/favicons?domain=startv.com.tr&sz=128'],
  [/NOW|FOX/i, 'https://www.google.com/s2/favicons?domain=nowtv.com.tr&sz=128'],
  [/TV8/i, 'https://www.google.com/s2/favicons?domain=tv8.com.tr&sz=128'],
  [/CNNTURK/i, 'https://www.google.com/s2/favicons?domain=cnnturk.com&sz=128'],
  [/HALKTV/i, 'https://www.google.com/s2/favicons?domain=halktv.com.tr&sz=128'],
  [/SOZCUTV|SZC/i, 'https://www.google.com/s2/favicons?domain=szctv.com.tr&sz=128'],
  [/TELE1/i, 'https://www.google.com/s2/favicons?domain=tele1.com.tr&sz=128'],
  [/BEIN/i, 'https://www.google.com/s2/favicons?domain=beinsports.com&sz=128'],
  [/EXXEN/i, 'https://www.google.com/s2/favicons?domain=exxen.com&sz=128'],
  [/TIVIBU/i, 'https://www.google.com/s2/favicons?domain=tivibu.com.tr&sz=128'],
  [/EUROSPORT/i, 'https://www.google.com/s2/favicons?domain=eurosport.com&sz=128'],
  [/DMAX/i, 'https://www.google.com/s2/favicons?domain=dmax.com.tr&sz=128'],
  [/TLC/i, 'https://www.google.com/s2/favicons?domain=tlctv.com.tr&sz=128'],
  [/DISCOVERY/i, 'https://www.google.com/s2/favicons?domain=discovery.com&sz=128'],
  [/NATIONALGEOGRAPHIC|NATGEO/i, 'https://www.google.com/s2/favicons?domain=nationalgeographic.com&sz=128'],
  [/CARTOONNETWORK/i, 'https://www.google.com/s2/favicons?domain=cartoonnetwork.com.tr&sz=128'],
  [/BEYAZTV/i, 'https://www.google.com/s2/favicons?domain=beyaztv.com.tr&sz=128'],
  [/KANAL7|ULKETV/i, 'https://www.google.com/s2/favicons?domain=kanal7.com&sz=128'],
  [/360|24TV|24HABER/i, 'https://www.google.com/s2/favicons?domain=tv360.com.tr&sz=128'],
  [/TGRT/i, 'https://www.google.com/s2/favicons?domain=tgrthaber.com&sz=128'],
  [/NUMBER1|NR1/i, 'https://www.google.com/s2/favicons?domain=numberone.com.tr&sz=128'],
];

async function buildLogoDirectory(): Promise<LogoDirectory> {
  const trMap = new Map<string, string[]>();
  const globalMap = new Map<string, string[]>();
  const trEntries: Array<{ key: string; urls: string[] }> = [];

  const pushMap = (map: Map<string, string[]>, key: string, url: string) => {
    if (!key || !url) return;
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    if (!arr.includes(url) && arr.length < 4) {
      arr.push(url);
    }
  };

  try {
    const [chResp, lgResp] = await Promise.all([
      fetch('https://iptv-org.github.io/api/channels.json', {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': DEFAULT_UA },
      }),
      fetch('https://iptv-org.github.io/api/logos.json', {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': DEFAULT_UA },
      }),
    ]);

    if (chResp.ok && lgResp.ok) {
      const channels = (await chResp.json()) as Array<{
        id: string;
        name: string;
        alt_names?: string[];
        country?: string;
        website?: string | null;
      }>;
      const logos = (await lgResp.json()) as Array<{
        channel: string;
        in_use?: boolean;
        format?: string | null;
        url: string;
      }>;

      // Group logo candidates per channel ID, preferring in_use + non-wikia + PNG/SVG
      const logosById = new Map<string, Array<{ score: number; url: string }>>();
      for (const l of logos) {
        if (!l.url || !validateExternalUrl(l.url)) continue;
        if (isDeadOrBlockedLogoUrl(l.url)) continue;
        const fmt = (l.format || '').toUpperCase();
        const score =
          (l.in_use ? 20 : 0) +
          (fmt === 'PNG' ? 10 : fmt === 'SVG' ? 8 : fmt === 'WEBP' ? 6 : 2) +
          (l.url.includes('imgur.com') ? 4 : 0);
        let list = logosById.get(l.channel);
        if (!list) {
          list = [];
          logosById.set(l.channel, list);
        }
        list.push({ score, url: l.url });
      }

      for (const c of channels) {
        const candidates = (logosById.get(c.id) || [])
          .sort((a, b) => b.score - a.score)
          .map((x) => x.url);

        if (c.website) {
          try {
            const siteUrl = new URL(c.website);
            if (!isPrivateOrBlockedHost(siteUrl.hostname)) {
              candidates.push(
                `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
                  siteUrl.hostname
                )}&sz=128`
              );
            }
          } catch {
            // ignore invalid website
          }
        }
        if (candidates.length === 0) continue;

        const isTr = c.country === 'TR';
        const names = [c.name, ...(c.alt_names || []), c.id.replace(/\.[a-z]{2}$/i, '')];
        for (const nm of names) {
          const k = normalizeChannelKeyForLogo(nm);
          if (!k) continue;
          for (const u of candidates.slice(0, 3)) {
            pushMap(globalMap, k, u);
            if (isTr) pushMap(trMap, k, u);
          }
        }
      }

      for (const [k, urls] of trMap.entries()) {
        trEntries.push({ key: k, urls });
      }
    }
  } catch {
    // Graceful fallback: directory remains populated by EPG/RadioBrowser/curated maps
  }

  // Merge RadioBrowser cached favicons
  for (const rList of radioCache.values()) {
    for (const s of rList.stations) {
      if (s.logoUrl && !isDeadOrBlockedLogoUrl(s.logoUrl)) {
        const k = normalizeChannelKeyForLogo(s.name);
        pushMap(trMap, k, s.logoUrl);
        pushMap(globalMap, k, s.logoUrl);
      }
    }
  }

  // Merge loaded EPG channel <icon> tags
  for (const epgEntry of epgCache.values()) {
    for (const [norm, iconUrl] of epgEntry.channelLogos.entries()) {
      if (!isDeadOrBlockedLogoUrl(iconUrl)) {
        pushMap(trMap, norm, iconUrl);
        pushMap(globalMap, norm, iconUrl);
      }
    }
  }

  return {
    fetchedAt: Date.now(),
    trMap,
    globalMap,
    trEntries,
  };
}

async function getLogoDirectory(): Promise<LogoDirectory> {
  if (logoDirectoryCache && Date.now() - logoDirectoryCache.fetchedAt < LOGO_DIR_TTL_MS) {
    return logoDirectoryCache;
  }
  if (!logoDirectoryPromise) {
    logoDirectoryPromise = buildLogoDirectory()
      .then((dir) => {
        logoDirectoryCache = dir;
        return dir;
      })
      .finally(() => {
        logoDirectoryPromise = null;
      });
  }
  return logoDirectoryPromise;
}

function resolveLogoCandidates(
  dir: LogoDirectory,
  rawName: string,
  _isRadio = false
): string[] {
  const isForeignPrefixed = /^(UK:|DE:|US:|FR:|NL:|RU:|AR:|IT:|ES:)/i.test(rawName.trim());
  const norm = normalizeChannelKeyForLogo(rawName);
  if (!norm) return [];

  const keysToTry: string[] = [norm];
  // Aliases for known rebrands & abbreviations
  if (norm === 'FOX' || norm === 'FOXTV') keysToTry.push('NOW', 'NOWTV');
  if (norm === '24' || norm === '24HABER') keysToTry.push('24TV');
  if (norm === 'SZC' || norm === 'SOZCU') keysToTry.push('SOZCUTV');
  if (norm === 'TV2') keysToTry.push('TEVE2');
  if (norm === 'NR1') keysToTry.push('NUMBER1TV', 'NUMBER1');
  if (norm === 'NR1DAMAR') keysToTry.push('NUMBER1DAMAR');
  if (norm === 'NUMBER1TURK') keysToTry.push('NUMBER1TURKTV');
  if (norm === 'POWERTV') keysToTry.push('POWERTURKTV');
  if (norm === 'EUROSPORT1' || norm === 'EUROSPORT2') keysToTry.push('EUROSPORT');
  if (norm.startsWith('SINEMATV') || norm.startsWith('SINEMA')) {
    keysToTry.push('SINEMATV');
  }
  if (norm.startsWith('BEINSPORTS')) keysToTry.push('BEINSPORTS1TURK', 'BEINSPORTS1');
  if (norm.startsWith('EXXENSPOR')) keysToTry.push('EXXEN');

  if (!norm.endsWith('TV')) keysToTry.push(`${norm}TV`);
  if (norm.endsWith('TV') && norm.length > 3) keysToTry.push(norm.slice(0, -2));
  if (norm.endsWith('FM') && norm.length > 3) keysToTry.push(norm.slice(0, -2));
  if (norm.endsWith('RADYO') && norm.length > 6) keysToTry.push(norm.slice(0, -5));

  const strippedDigits = norm.replace(/\d+$/, '');
  if (strippedDigits.length >= 4 && strippedDigits !== norm) {
    keysToTry.push(strippedDigits, `${strippedDigits}TV`);
  }

  const out: string[] = [];
  const pushAll = (urls?: string[]) => {
    if (!urls) return;
    for (const u of urls) {
      if (!out.includes(u)) out.push(u);
    }
  };

  if (!isForeignPrefixed) {
    for (const k of keysToTry) {
      pushAll(dir.trMap.get(k));
    }
  }
  for (const k of keysToTry) {
    pushAll(dir.globalMap.get(k));
  }

  // Fuzzy prefix/substring match against Turkish directory when exact failed
  if (out.length === 0 && !isForeignPrefixed && norm.length >= 4) {
    for (const entry of dir.trEntries) {
      if (
        entry.key.length >= 4 &&
        (entry.key.startsWith(norm) || norm.startsWith(entry.key))
      ) {
        pushAll(entry.urls);
        if (out.length >= 2) break;
      }
    }
  }

  // Curated official website favicon / CDN fallback
  for (const [rx, fallbackUrl] of CURATED_FALLBACK_DOMAINS) {
    if (rx.test(norm)) {
      if (!out.includes(fallbackUrl)) out.push(fallbackUrl);
    }
  }

  return out;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

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
    const scope =
      req.query.scope === 'global'
        ? 'global'
        : req.query.scope === 'kurdish'
        ? 'kurdish'
        : 'tr';
    const forceRefresh = req.query.refresh === '1';
    if (forceRefresh) {
      radioCache.delete(scope);
    }
    try {
      const stations = await fetchOnlineRadios(scope);
      const dir = await getLogoDirectory().catch(() => null);
      const enrichedStations = dir
        ? stations.map((s) => {
            if (s.logoUrl && !isDeadOrBlockedLogoUrl(s.logoUrl)) return s;
            const candidates = resolveLogoCandidates(dir, s.name, true);
            return candidates[0] ? { ...s, logoUrl: candidates[0] } : s;
          })
        : stations;
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ stations: enrichedStations, count: enrichedStations.length });
    } catch {
      const fb = scope === 'kurdish' ? FALLBACK_KURDISH_RADIOS : FALLBACK_TURKISH_RADIOS;
      const dir = await getLogoDirectory().catch(() => null);
      const enrichedFb = dir
        ? fb.map((s) => {
            if (s.logoUrl && !isDeadOrBlockedLogoUrl(s.logoUrl)) return s;
            const candidates = resolveLogoCandidates(dir, s.name, true);
            return candidates[0] ? { ...s, logoUrl: candidates[0] } : s;
          })
        : fb;
      return res.json({
        stations: enrichedFb,
        count: enrichedFb.length,
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

  const SERVER_ADULT_PATTERNS: RegExp[] = [
    /(?:^|[\s._/|\-[\]():,])\+?18\+?(?:$|[\s._/|\-[\]():,])/i,
    /(?:^|[\s._/|\-[\]():,])(xxx|nsfw|erotik|erotic|erotica|yetiskin|yetişkin|adult|adults|hentai|porn|porno|pornhub|xvideos|xnxx|redtube|youporn|xhamster|brazzers|bangbros|chaturbate|onlyfans|playboy|hustler|penthouse|dorcel|babestation|vivid|hardcore|softcore|camgirl|sexmex|nudity|stripclub|fetish|milf|redlight|beate\s*uhse|blue\s*movie|lust\s*pur|blue\s*hustler|venus\s*tv|private\s*tv|man-x)(?:$|[\s._/|\-[\]():,])/i,
    /(?:^|[\s._/|\-[\]():,])(sex|sexy|nude)(?:$|[\s._/|\-[\]():,])/i,
  ];

  function isAdultServerText(name: string, group?: string | null, url?: string | null): boolean {
    const text = `${name || ''} | ${group || ''} | ${url || ''}`;
    return SERVER_ADULT_PATTERNS.some((rx) => rx.test(text));
  }

  interface CloudStreamPluginDto {
    name?: string;
    description?: string;
    tvTypes?: string[];
    status?: number;
    iconUrl?: string;
    language?: string;
    repositoryUrl?: string;
  }

  async function resolveCloudStreamRepoToM3u(
    rawJsonText: string,
    sourceUrl: string,
    signal?: AbortSignal
  ): Promise<{ content: string; count: number; repoName: string; providerCount: number } | null> {
    try {
      const parsed = JSON.parse(rawJsonText) as unknown;
      let repoName = 'CloudStream Repo';
      let plugins: CloudStreamPluginDto[] = [];

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (!Array.isArray(obj.pluginLists)) {
          return null;
        }
        if (typeof obj.name === 'string' && obj.name.trim()) {
          repoName = obj.name.trim();
        }
        const pluginListUrls = (obj.pluginLists as unknown[])
          .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
          .slice(0, 4);

        const listResponses = await Promise.allSettled(
          pluginListUrls.map(async (plUrl) => {
            const validPl = validateExternalUrl(normalizeGithubSourceUrl(plUrl));
            if (!validPl) return [];
            const resp = await fetch(validPl.toString(), {
              signal: signal ?? AbortSignal.timeout(10000),
              headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
            });
            if (!resp.ok) return [];
            const arr = (await resp.json()) as unknown;
            return Array.isArray(arr) ? (arr as CloudStreamPluginDto[]) : [];
          })
        );
        for (const r of listResponses) {
          if (r.status === 'fulfilled') plugins.push(...r.value);
        }
      } else if (Array.isArray(parsed)) {
        const looksLikePlugins = parsed.some(
          (el) =>
            el &&
            typeof el === 'object' &&
            ('tvTypes' in (el as Record<string, unknown>) ||
              'internalName' in (el as Record<string, unknown>))
        );
        if (!looksLikePlugins) return null;
        plugins = parsed as CloudStreamPluginDto[];
      } else {
        return null;
      }

      // Filter out disabled (status === 0) and NSFW/adult plugins
      const safePlugins = plugins.filter((p) => {
        if (!p || typeof p.name !== 'string') return false;
        if (p.status === 0) return false;
        const types = Array.isArray(p.tvTypes) ? p.tvTypes : [];
        if (types.some((t) => /nsfw|adult|18/i.test(String(t)))) return false;
        if (isAdultServerText(p.name, p.description || '', p.repositoryUrl || '')) return false;
        return true;
      });

      const isSportsFocused =
        /spor|sport|ma[cç]/i.test(`${repoName} ${sourceUrl}`) ||
        safePlugins.filter((p) => (p.tvTypes || []).includes('Live')).length >
          safePlugins.length * 0.55;

      // Extract any explicit site domains mentioned inside provider descriptions for direct stream scraping
      const domainCandidates = new Set<string>();
      for (const p of safePlugins.slice(0, 40)) {
        const desc = `${p.description || ''}`;
        const matches = desc.match(/\b([a-z0-9-]+\.(?:com\.tr|com|net|tv|st|eu|info|site|org|pw))\b/gi) || [];
        for (const dom of matches) {
          const clean = dom.toLowerCase();
          if (
            clean !== 'github.com' &&
            clean !== 'raw.githubusercontent.com' &&
            !isAdultServerText(clean)
          ) {
            domainCandidates.add(`https://${clean}`);
          }
          if (domainCandidates.size >= 6) break;
        }
        if (domainCandidates.size >= 6) break;
      }

      const lines: string[] = ['#EXTM3U'];
      const seenStreamUrls = new Set<string>();
      let count = 0;

      const pushM3uLine = (
        name: string,
        streamUrl: string,
        groupTitle: string,
        logoUrl?: string | null
      ) => {
        const cleanUrl = streamUrl.trim();
        if (!cleanUrl || seenStreamUrls.has(cleanUrl)) return;
        if (!validateExternalUrl(cleanUrl)) return;
        if (isAdultServerText(name, groupTitle, cleanUrl)) return;
        seenStreamUrls.add(cleanUrl);
        const safeName = name.replace(/[\r\n"]+/g, ' ').trim();
        const safeGroup = groupTitle.replace(/[\r\n"]+/g, ' ').trim() || repoName;
        const logoAttr =
          logoUrl && validateExternalUrl(logoUrl)
            ? ` tvg-logo="${logoUrl.replace(/"/g, '')}"`
            : '';
        lines.push(
          `#EXTINF:-1 tvg-name="${safeName}"${logoAttr} group-title="${safeGroup}",${safeName}`
        );
        lines.push(cleanUrl);
        count++;
      };

      if (isSportsFocused) {
        // Sports & Live TV repo (e.g., TurkSpor): pull verified Turkish live & sports streams + Vavoo Sports/TR subset
        const feedTasks = await Promise.allSettled([
          fetch('https://vavoo-list.optis02.workers.dev/', {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': DEFAULT_UA },
          }).then((r) => (r.ok ? r.text() : '')),
          fetch('https://iptv-org.github.io/iptv/categories/sports.m3u', {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': DEFAULT_UA },
          }).then((r) => (r.ok ? r.text() : '')),
        ]);

        for (const task of feedTasks) {
          if (task.status !== 'fulfilled' || !task.value) continue;
          const rawLines = task.value.split(/\r?\n/);
          let curName = '';
          let curLogo: string | null = null;
          let curGroup = 'Spor';
          let addedFromFeed = 0;
          for (const rawLine of rawLines) {
            const l = rawLine.trim();
            if (!l) continue;
            if (l.startsWith('#EXTINF:')) {
              const lm = /tvg-logo="([^"]*)"/.exec(l);
              curLogo = lm?.[1]?.trim() || null;
              const gm = /group-title="([^"]*)"/.exec(l);
              curGroup = gm?.[1]?.trim() || 'Spor';
              const cIdx = l.lastIndexOf(',');
              curName = cIdx >= 0 ? l.slice(cIdx + 1).trim() : '';
            } else if (!l.startsWith('#') && /^https?:\/\//i.test(l)) {
              const isRelevant =
                /spor|sport|bein|exxen|tivibu|trt|nba|dazn|euro|f1|ufc|sky|tjk|tabii/i.test(
                  `${curName} ${curGroup}`
                ) || /turkey/i.test(curGroup);
              if (curName && isRelevant && addedFromFeed < 180) {
                const taggedGroup = /spor|sport|bein|exxen|tivibu|nba|dazn|euro/i.test(curName)
                  ? `Spor · ${repoName}`
                  : `${repoName} · Canlı TV`;
                pushM3uLine(curName, l, taggedGroup, curLogo);
                addedFromFeed++;
              }
              curName = '';
              curLogo = null;
            }
          }
        }
      } else {
        // Cinema / Series / Documentary / Anime repo (e.g., TurkSinema): scrape safe open domains + Archive + IPTV-org VOD
        const [scrapedLists, trArchive, worldArchive, cinemaFeeds] = await Promise.all([
          Promise.allSettled([...domainCandidates].map((u) => scrapeVodLinksFromWebPage(u))),
          fetchInternetArchiveVod(
            'mediatype:movies AND (yesilcam OR turkish OR turk OR sinema)',
            14
          ),
          fetchInternetArchiveVod(
            'mediatype:movies AND collection:(feature_films OR classic_tv OR animationandcartoons)',
            16
          ),
          fetchIptvCinemaVodFeeds(),
        ]);

        for (const task of scrapedLists) {
          if (task.status === 'fulfilled') {
            for (const item of task.value) {
              pushM3uLine(
                item.name,
                item.streamUrl,
                `${repoName} · ${item.category}`,
                item.posterUrl
              );
            }
          }
        }
        for (const item of [...trArchive, ...worldArchive, ...cinemaFeeds]) {
          pushM3uLine(
            item.name,
            item.streamUrl,
            `${repoName} · ${item.category}`,
            item.posterUrl
          );
        }
      }

      if (count === 0) return null;
      return {
        content: lines.join('\n'),
        count,
        repoName,
        providerCount: safePlugins.length,
      };
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
    metaNote?: string;
  }> {
    const normalized = normalizeGithubSourceUrl(rawUrl);
    const parsed = validateExternalUrl(normalized);
    if (!parsed) {
      throw new Error('Geçersiz veya desteklenmeyen adres.');
    }

    const doFetch = (targetUrl: string, ua: string) =>
      fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: signal ?? AbortSignal.timeout(18000),
        headers: {
          'User-Agent': ua,
          Accept: '*/*',
          'Cache-Control': 'no-cache',
        },
      });

    let upstream: globalThis.Response;
    try {
      upstream = await doFetch(parsed.toString(), DEFAULT_UA);
      if (
        !upstream.ok &&
        (upstream.status === 403 || upstream.status === 406 || upstream.status === 429)
      ) {
        upstream = await doFetch(parsed.toString(), 'IPTVSmartersPro');
      }
    } catch (fetchErr) {
      // Fallback for IPv4 hosts with self-signed TLS certs: try http:// if https:// failed
      const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname);
      if (parsed.protocol === 'https:' && isIpv4) {
        const httpUrl = `http://${parsed.host}${parsed.pathname}${parsed.search}`;
        upstream = await doFetch(httpUrl, 'IPTVSmartersPro');
      } else {
        throw fetchErr;
      }
    }

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
      if (converted) {
        return {
          content: converted.content,
          format: 'json',
          count: converted.count,
          resolvedUrl: parsed.toString(),
        };
      }

      // Check for CloudStream repo.json / plugins.json manifest (e.g. TurkSinema / TurkSpor)
      const repoResolved = await resolveCloudStreamRepoToM3u(
        content,
        parsed.toString(),
        signal
      );
      if (repoResolved) {
        return {
          content: repoResolved.content,
          format: 'json',
          count: repoResolved.count,
          resolvedUrl: parsed.toString(),
          metaNote: `${repoResolved.repoName} (${repoResolved.providerCount} sağlayıcı, +18 hariç)`,
        };
      }

      throw new Error('JSON dosyası içinde geçerli yayın kanalı bulunamadı.');
    }

    if (!content.includes('#EXTM3U') && !content.includes('#EXTINF')) {
      // Handle HTML Media Portals (e.g., Vuma/Vavoo portal http://131.123.43.89/# or pages embedding .m3u links)
      const embeddedPlaylists = extractPlaylistLinksFromHtmlOrText(content);
      if (embeddedPlaylists.length > 0) {
        for (const plUrl of embeddedPlaylists.slice(0, 3)) {
          try {
            const sub = await fetchRemotePlaylistOrJson(plUrl, signal);
            if (sub.content) return sub;
          } catch {
            // try next embedded link
          }
        }
      }

      const isVavooPortal =
        /vuma|vavoo|geil\.to|"id"\s*:\s*"vavoo"/i.test(content);
      if (isVavooPortal) {
        const vavooResp = await fetch('https://vavoo-list.optis02.workers.dev/', {
          signal: signal ?? AbortSignal.timeout(12000),
          headers: { 'User-Agent': DEFAULT_UA },
        });
        if (vavooResp.ok) {
          const vavooM3u = await vavooResp.text();
          if (vavooM3u.includes('#EXTM3U')) {
            return {
              content: vavooM3u,
              format: 'm3u',
              resolvedUrl: parsed.toString(),
              metaNote: 'Vavoo/Vuma portalı canlı yayın listesine bağlandı',
            };
          }
        }
      }

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

  // Embedded AI (Gemini 4 + Google Search Grounding) Full-Web M3U/JSON Auto-Discovery, Verification & Immediate Publish
  const KNOWN_IPTV_ORG_PLAYLISTS: Array<{ slug: string; label: string; tags: string }> = [
    { slug: 'countries/tr.m3u', label: 'Türkiye Canlı TV', tags: 'türkiye turkish haber ulusal tv' },
    { slug: 'languages/tur.m3u', label: 'Türkçe Yayınlar', tags: 'türkçe turkish genel ulusal' },
    { slug: 'languages/kur.m3u', label: 'Kürtçe TV Yayınları', tags: 'kürtçe kurdish kurdi' },
    { slug: 'categories/sports.m3u', label: 'Spor Kanalları', tags: 'spor futbol basketbol maç' },
    { slug: 'categories/movies.m3u', label: 'Sinema & Filmler', tags: 'sinema film dizi movie' },
    { slug: 'categories/news.m3u', label: 'Haber Kanalları', tags: 'haber news güncel' },
    { slug: 'categories/music.m3u', label: 'Müzik & Radyo TV', tags: 'müzik klip şarkı radyo' },
    { slug: 'categories/documentary.m3u', label: 'Belgesel & Doğa', tags: 'belgesel doğa bilim tarih' },
    { slug: 'categories/kids.m3u', label: 'Çocuk & Çizgi Film', tags: 'çocuk çizgi film animasyon' },
    { slug: 'categories/entertainment.m3u', label: 'Eğlence & Genel', tags: 'eğlence magazin dizi' },
    { slug: 'categories/comedy.m3u', label: 'Komedi & Eğlence', tags: 'komedi eğlence şov' },
    { slug: 'categories/education.m3u', label: 'Eğitim & Bilim', tags: 'eğitim bilim kültür' },
  ];

  // Published AI-discovered playlists kept live on the server so /api/export/playlist.m3u8 immediately serves them
  const publishedAiSources = new Map<
    string,
    { name: string; url: string; format: 'm3u' | 'json'; content: string; publishedAt: string }
  >();

  function extractChannelSampleFromPlaylist(content: string): {
    count: number;
    samples: string[];
  } {
    const lines = content.split(/\r?\n/);
    const samples: string[] = [];
    let count = 0;
    for (const line of lines) {
      if (line.startsWith('#EXTINF')) {
        count++;
        if (samples.length < 6) {
          const commaIdx = line.lastIndexOf(',');
          const title = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '';
          if (title) samples.push(title);
        }
      }
    }
    return { count, samples };
  }

  function extractPlaylistLinksFromHtmlOrText(text: string): string[] {
    const found = new Set<string>();
    const urlMatches = text.match(/https?:\/\/[^\s"'<>()[\]\\,;{}]+/gi) || [];
    for (let raw of urlMatches) {
      raw = raw.replace(/[.,;:!?)]+$/, '');
      const normalized = normalizeGithubSourceUrl(raw);
      const lower = normalized.toLowerCase();
      if (
        /\.(m3u8?|txt)(\?|$)/i.test(lower) ||
        (lower.endsWith('.json') && /(tv|iptv|channel|list|spor|radyo|film)/i.test(lower)) ||
        lower.includes('raw.githubusercontent.com') ||
        lower.includes('iptv-org.github.io') ||
        lower.includes('pastebin.com/raw/') ||
        lower.includes('gitlab.com/') ||
        lower.includes('codeberg.org/')
      ) {
        if (validateExternalUrl(normalized)) {
          found.add(normalized);
        }
      }
    }
    return [...found];
  }

  async function resolveCandidatePlaylistsFromUrl(
    candidateUrl: string
  ): Promise<string[]> {
    const normalized = normalizeGithubSourceUrl(candidateUrl);
    if (!validateExternalUrl(normalized)) return [];
    const lower = normalized.toLowerCase();
    // If it already looks like a raw playlist or JSON, return directly
    if (
      /\.(m3u8?|json|txt)(\?|$)/i.test(lower) ||
      lower.includes('raw.githubusercontent.com') ||
      lower.includes('pastebin.com/raw/')
    ) {
      return [normalized];
    }
    // Otherwise try fetching HTML web page (blog/directory/GitLab/GitHub page) and extract embedded .m3u links
    try {
      const resp = await fetch(normalized, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(7000),
        headers: { 'User-Agent': DEFAULT_UA, Accept: 'text/html,text/plain,*/*' },
      });
      if (!resp.ok) return [];
      const body = (await resp.text()).slice(0, 400_000);
      if (body.includes('#EXTM3U') || body.includes('#EXTINF')) {
        return [normalized];
      }
      return extractPlaylistLinksFromHtmlOrText(body).slice(0, 6);
    } catch {
      return [];
    }
  }

  const handleAiDiscoverWebAndGithub = async (req: Request, res: Response) => {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY yapılandırılmamış. Lütfen Settings > Secrets panelinden API anahtarını ekleyin.',
      });
    }

    const attemptNonce =
      typeof req.body?.attemptNonce === 'number' ? req.body.attemptNonce : Date.now();
    const rawUserTopic =
      typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    const userTopic: string = rawUserTopic
      ? rawUserTopic.slice(0, 160)
      : 'Türkçe canlı TV, spor, haber, kürtçe yayınlar, sinema, belgesel ve müzik M3U listeleri';

    const existingSet = new Set<string>(
      Array.isArray(req.body?.existingUrls)
        ? req.body.existingUrls
            .filter((u: unknown): u is string => typeof u === 'string')
            .map((u: string) => normalizeGithubSourceUrl(u))
        : []
    );

    const searchAngles = [
      'iptv-org github free-tv pastebin raw.githubusercontent',
      'turkish iptv m3u8 playlist web gitlab codeberg',
      'kurdish sports movies music m3u playlist public',
      'turkey live tv channels m3u github gist blog',
    ];
    const activeAngle = searchAngles[Math.abs(Math.floor(attemptNonce)) % searchAngles.length];

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    try {
      // Step 1: Full-Web Discovery via Google Search Grounding (NEVER mix googleSearch with responseSchema!)
      const planResp = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Kullanıcı isteği: "${userTopic}". Arama odağı: ${activeAngle}.
Tüm web genelinde (IPTV siteleri, Pastebin, GitLab, Codeberg, Bloglar, Gist ve GitHub dahil) doğrudan çalışan açık kaynaklı .m3u, .m3u8 ve IPTV .json yayın listesi URL'lerini Google Search ile bul.
Şu adreslerden halihazırda ekli olanları tekrarlama: ${[...existingSet].slice(0, 12).join(', ') || 'yok'}.
Bulduğun tüm doğrudan .m3u / .m3u8 / .json linklerini ve playlist barındıran sayfaların tam https:// adreslerini liste halinde yaz.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          tools: [{ googleSearch: {} }],
        },
      });

      const webSources: Array<{ title: string; uri: string }> = [];
      const seenWebUri = new Set<string>();
      const rawText = planResp.text || '';
      const candidatePagesToScrape = new Set<string>();
      const candidateUrls = new Set<string>();

      // Extract grounded web citations & URLs returned by Google Search Grounding
      const chunks =
        planResp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      for (const chunk of chunks) {
        const uri = chunk?.web?.uri;
        if (typeof uri === 'string' && validateExternalUrl(uri)) {
          if (!seenWebUri.has(uri)) {
            seenWebUri.add(uri);
            webSources.push({
              title: chunk?.web?.title || uri,
              uri,
            });
          }
          const norm = normalizeGithubSourceUrl(uri);
          if (/\.(m3u8?|json|txt)(\?|$)/i.test(norm)) {
            if (!existingSet.has(norm)) candidateUrls.add(norm);
          } else {
            candidatePagesToScrape.add(norm);
          }
        }
      }

      // Extract any playlist URLs directly present in Gemini's text output
      for (const directUrl of extractPlaylistLinksFromHtmlOrText(rawText)) {
        if (!existingSet.has(directUrl)) {
          candidateUrls.add(directUrl);
        }
      }

      // Also extract non-playlist page links mentioned in text to scan their HTML for .m3u links
      const allTextUrls = rawText.match(/https?:\/\/[^\s"'<>()[\]\\,;{}]+/gi) || [];
      for (let u of allTextUrls) {
        u = normalizeGithubSourceUrl(u.replace(/[.,;:!?)]+$/, ''));
        if (validateExternalUrl(u) && !candidateUrls.has(u) && candidatePagesToScrape.size < 8) {
          candidatePagesToScrape.add(u);
        }
      }

      // Step 2: Parallel HTML link extraction from grounded web pages + live GitHub API search + known mirrors
      const ghQueryTerms = userTopic
        .toLowerCase()
        .replace(/[^a-zçğıöşü0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length >= 3)
        .slice(0, 3);
      const ghQueries = [
        `iptv m3u ${ghQueryTerms.slice(0, 2).join(' ') || 'turkey'}`.trim(),
        'turkish tv m3u8 iptv',
      ];

      await Promise.allSettled([
        // Scrape grounded web pages (blogs, Pastebin, GitLab, IPTV index pages) for embedded .m3u links
        ...[...candidatePagesToScrape].slice(0, 6).map(async (pageUrl) => {
          const extracted = await resolveCandidatePlaylistsFromUrl(pageUrl);
          for (const ex of extracted) {
            if (!existingSet.has(ex)) {
              candidateUrls.add(ex);
            }
          }
        }),
        // Live GitHub repository scan
        ...ghQueries.map(async (q) => {
          const ghUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(
            q
          )}&sort=updated&order=desc&per_page=4`;
          const ghResp = await fetch(ghUrl, {
            signal: AbortSignal.timeout(8000),
            headers: {
              'User-Agent': 'EymenTVRadyo/1.0',
              Accept: 'application/vnd.github+json',
            },
          });
          if (!ghResp.ok) return;
          const ghData = (await ghResp.json()) as {
            items?: Array<{ full_name?: string; default_branch?: string }>;
          };
          const repos = (ghData.items || []).slice(0, 3);
          await Promise.allSettled(
            repos.map(async (repo) => {
              if (!repo.full_name) return;
              const branch = repo.default_branch || 'main';
              const contentsResp = await fetch(
                `https://api.github.com/repos/${repo.full_name}/contents/`,
                {
                  signal: AbortSignal.timeout(7000),
                  headers: {
                    'User-Agent': 'EymenTVRadyo/1.0',
                    Accept: 'application/vnd.github+json',
                  },
                }
              );
              if (!contentsResp.ok) return;
              const files = (await contentsResp.json()) as Array<{
                name?: string;
                type?: string;
                download_url?: string;
              }>;
              if (!Array.isArray(files)) return;
              for (const f of files) {
                if (f.type !== 'file' || !f.name) continue;
                const lower = f.name.toLowerCase();
                if (
                  lower.endsWith('.m3u') ||
                  lower.endsWith('.m3u8') ||
                  (lower.endsWith('.json') &&
                    /(tv|channel|iptv|list|spor|radyo)/.test(lower))
                ) {
                  const rawUrl =
                    f.download_url ||
                    `https://raw.githubusercontent.com/${repo.full_name}/${branch}/${f.name}`;
                  if (!existingSet.has(rawUrl)) {
                    candidateUrls.add(rawUrl);
                  }
                }
              }
            })
          );
        }),
      ]);

      // Top up with unadded iptv-org curated playlists if few fresh web candidates remain
      for (const known of KNOWN_IPTV_ORG_PLAYLISTS) {
        const full = `https://iptv-org.github.io/iptv/${known.slug}`;
        if (!existingSet.has(full)) {
          candidateUrls.add(full);
          if (candidateUrls.size >= 12) break;
        }
      }

      const candidatesToVerify = [...candidateUrls].slice(0, 12);
      if (candidatesToVerify.length === 0) {
        return res.json({
          lists: [],
          webSources,
          publishedCount: publishedAiSources.size,
          publishedUrl: '/api/export/playlist.m3u8',
          summary:
            'Web ve GitHub tarandı; listeniz zaten tüm bulunan kaynakları içeriyor ve yayında.',
          model: 'gemini-4-hydrogen',
        });
      }

      // Step 3: Live-verify every candidate playlist before returning & publishing
      const settled = await Promise.allSettled(
        candidatesToVerify.map((u) =>
          fetchRemotePlaylistOrJson(u, AbortSignal.timeout(12000))
        )
      );

      const verified: Array<{
        url: string;
        format: 'm3u' | 'json';
        channelCount: number;
        samples: string[];
        content: string;
      }> = [];

      for (const item of settled) {
        if (item.status !== 'fulfilled') continue;
        const info = extractChannelSampleFromPlaylist(item.value.content);
        const count = item.value.count ?? info.count;
        if (count > 0) {
          verified.push({
            url: item.value.resolvedUrl,
            format: item.value.format,
            channelCount: count,
            samples: info.samples,
            content: item.value.content,
          });
        }
      }

      if (verified.length === 0) {
        return res.json({
          lists: [],
          webSources,
          publishedCount: publishedAiSources.size,
          publishedUrl: '/api/export/playlist.m3u8',
          summary:
            'Web taramasında çalışan yeni liste doğrulanamadı. Birkaç saniye sonra tekrar tıklayın.',
          model: 'gemini-4-hydrogen',
        });
      }

      // Step 4: Rank & write clean Turkish labels (without googleSearch so responseSchema works cleanly)
      const summaryForRank = verified.map((v) => ({
        url: v.url,
        format: v.format,
        channelCount: v.channelCount,
        samples: v.samples,
      }));

      const rankResp = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Kullanıcı isteği: "${userTopic}".\nWeb ve GitHub'dan doğrulanmış canlı yayın listeleri:\n${JSON.stringify(
          summaryForRank,
          null,
          2
        )}\nEn faydalı en fazla 5 listeyi seç, her birine kısa Türkçe ad (ör. "AI Web · Türkçe Spor M3U") ve 1 cümlelik açıklama yaz.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              selected: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    url: { type: Type.STRING },
                    name: { type: Type.STRING },
                    reason: { type: Type.STRING },
                  },
                  required: ['url', 'name', 'reason'],
                },
              },
            },
            required: ['summary', 'selected'],
          },
        },
      });

      const ranked = JSON.parse((rankResp.text ?? '{}').trim()) as {
        summary?: string;
        selected?: Array<{ url: string; name: string; reason: string }>;
      };

      const verifiedByUrl = new Map(verified.map((v) => [v.url, v]));
      const finalLists: Array<{
        name: string;
        url: string;
        format: 'm3u' | 'json';
        channelCount: number;
        reason: string;
      }> = [];

      for (const s of ranked.selected || []) {
        const match = verifiedByUrl.get(s.url);
        if (!match) continue;
        if (finalLists.some((f) => f.url === match.url)) continue;
        const cleanName = s.name.trim() || 'AI Web · Canlı M3U Listesi';
        finalLists.push({
          name: cleanName,
          url: match.url,
          format: match.format,
          channelCount: match.channelCount,
          reason: s.reason.trim(),
        });
        publishedAiSources.set(match.url, {
          name: cleanName,
          url: match.url,
          format: match.format,
          content: match.content,
          publishedAt: new Date().toISOString(),
        });
      }

      if (finalLists.length === 0) {
        for (const v of verified.slice(0, 5)) {
          const fileName = v.url.split('/').pop() || 'liste.m3u';
          const cleanName = `AI Web · ${fileName}`;
          finalLists.push({
            name: cleanName,
            url: v.url,
            format: v.format,
            channelCount: v.channelCount,
            reason: `${v.channelCount} çalışan kanal doğrulandı.`,
          });
          publishedAiSources.set(v.url, {
            name: cleanName,
            url: v.url,
            format: v.format,
            content: v.content,
            publishedAt: new Date().toISOString(),
          });
        }
      }

      const totalFoundChannels = finalLists.reduce((acc, x) => acc + x.channelCount, 0);

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        lists: finalLists,
        webSources,
        publishedCount: publishedAiSources.size,
        publishedUrl: '/api/export/playlist.m3u8',
        summary:
          ranked.summary ||
          `Yapay zeka tüm web genelinde ${finalLists.length} liste (${totalFoundChannels} kanal) buldu, ekledi ve hemen yayınladı.`,
        model: 'gemini-4-hydrogen',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI web taraması başarısız oldu.';
      const status =
        msg.includes('403') || msg.includes('PERMISSION_DENIED')
          ? 403
          : msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
          ? 429
          : 502;
      return res.status(status).json({ error: msg });
    }
  };

  app.post('/api/ai/discover-github-lists', handleAiDiscoverWebAndGithub);
  app.post('/api/ai/discover-web-lists', handleAiDiscoverWebAndGithub);

  app.get('/api/ai/published', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      publishedCount: publishedAiSources.size,
      publishedVodCount: publishedAiVodItems.size,
      publishedUrl: '/api/export/playlist.m3u8',
      sources: [...publishedAiSources.values()].map((s) => ({
        name: s.name,
        url: s.url,
        format: s.format,
        publishedAt: s.publishedAt,
      })),
    });
  });

  // Auto-Populated Cinema & Series (VOD) Catalog + Embedded AI Web Movie/Series Discovery
  interface VodCatalogDto {
    id: string;
    name: string;
    streamUrl: string;
    posterUrl: string | null;
    type: 'movie' | 'series';
    category: string;
    year?: string;
    sourceSite?: string;
  }

  const publishedAiVodItems = new Map<string, VodCatalogDto>();
  let vodCatalogCache: {
    fetchedAt: number;
    m3uContent: string;
    count: number;
    updatedAt: string;
  } | null = null;
  const VOD_CATALOG_TTL_MS = 15 * 60 * 1000;

  function buildVodM3uFromItems(items: VodCatalogDto[]): string {
    const seen = new Set<string>();
    const lines: string[] = ['#EXTM3U'];
    for (const item of items) {
      const cleanUrl = item.streamUrl.trim();
      if (!cleanUrl || seen.has(cleanUrl) || !validateExternalUrl(cleanUrl)) continue;
      if (isAdultServerText(item.name, item.category, cleanUrl)) continue;
      seen.add(cleanUrl);
      const safeName = item.name.replace(/[\r\n]+/g, ' ').trim();
      const safeCat = (item.category || (item.type === 'series' ? 'Diziler' : 'Genel Filmler'))
        .replace(/"/g, '')
        .trim();
      const prefix = item.type === 'series' ? 'Dizi' : 'Film';
      const groupTitle = safeCat.toLowerCase().includes(prefix.toLowerCase())
        ? safeCat
        : `${prefix} · ${safeCat}`;
      const logoAttr =
        item.posterUrl && validateExternalUrl(item.posterUrl)
          ? ` tvg-logo="${item.posterUrl.replace(/"/g, '')}"`
          : '';
      const yearTag =
        item.year && !safeName.includes(item.year) ? ` (${item.year})` : '';
      lines.push(
        `#EXTINF:-1 tvg-name="${safeName.replace(/"/g, '')}"${logoAttr} group-title="${groupTitle}",${safeName}${yearTag}`
      );
      lines.push(cleanUrl);
    }
    return lines.join('\n');
  }

  function classifyArchiveCategory(title: string, subjectRaw: unknown): {
    type: 'movie' | 'series';
    category: string;
  } {
    const subj = Array.isArray(subjectRaw)
      ? subjectRaw.join(' ')
      : typeof subjectRaw === 'string'
      ? subjectRaw
      : '';
    const text = `${title} ${subj}`.toLowerCase();
    const isSeries =
      /(series|serial|episode|season|sezon|bölüm|bolum|dizi|classic_tv|sitcom)/.test(text);
    if (/(yesilcam|yeşilçam|turkish|türkçe|turkce|turkiye|türkiye|yerli)/.test(text)) {
      return { type: isSeries ? 'series' : 'movie', category: 'Türk Yapımları' };
    }
    if (/(animation|cartoon|anime|çizgi|animasyon|disney|pixar)/.test(text)) {
      return { type: isSeries ? 'series' : 'movie', category: 'Animasyon & Aile' };
    }
    if (/(sci-fi|science fiction|space|alien|bilim kurgu|fantasy)/.test(text)) {
      return { type: isSeries ? 'series' : 'movie', category: 'Bilim Kurgu & Fantastik' };
    }
    if (/(horror|thriller|monster|vampire|zombie|korku|gerilim|mystery)/.test(text)) {
      return { type: isSeries ? 'series' : 'movie', category: 'Korku & Gerilim' };
    }
    if (/(comedy|chaplin|keaton|laurel|komedi|funny)/.test(text)) {
      return { type: isSeries ? 'series' : 'movie', category: 'Komedi' };
    }
    if (/(action|adventure|western|crime|war|aksiyon|macera)/.test(text)) {
      return { type: isSeries ? 'series' : 'movie', category: 'Aksiyon & Macera' };
    }
    if (/(documentary|history|nature|science|belgesel)/.test(text)) {
      return { type: 'movie', category: 'Belgesel' };
    }
    if (/(drama|romance|love|dram)/.test(text)) {
      return { type: isSeries ? 'series' : 'movie', category: 'Dram & Romantik' };
    }
    return {
      type: isSeries ? 'series' : 'movie',
      category: isSeries ? 'Diziler' : 'Genel Filmler',
    };
  }

  async function fetchInternetArchiveVod(
    query: string,
    rows: number
  ): Promise<VodCatalogDto[]> {
    try {
      const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
        query
      )}&fl[]=identifier,title,year,subject&sort[]=downloads+desc&rows=${rows}&output=json`;
      const resp = await fetch(searchUrl, {
        signal: AbortSignal.timeout(7000),
        headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
      });
      if (!resp.ok) return [];
      const json = (await resp.json()) as {
        response?: {
          docs?: Array<{
            identifier?: string;
            title?: string;
            year?: string | number;
            subject?: string | string[];
          }>;
        };
      };
      const docs = (json.response?.docs || []).slice(0, 14);
      const settled = await Promise.allSettled(
        docs.map(async (doc): Promise<VodCatalogDto | null> => {
          const id = (doc.identifier || '').trim();
          const title = (doc.title || '').trim();
          if (!id || !title) return null;
          const filesResp = await fetch(
            `https://archive.org/metadata/${encodeURIComponent(id)}/files`,
            {
              signal: AbortSignal.timeout(5000),
              headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
            }
          );
          if (!filesResp.ok) return null;
          const filesData = (await filesResp.json()) as {
            result?: Array<{ name?: string; format?: string; size?: string | number }>;
          };
          const mp4Files = (filesData.result || []).filter((f) => {
            const fname = (f.name || '').toLowerCase();
            if (!fname.endsWith('.mp4')) return false;
            const sizeBytes = Number(f.size || 0);
            if (sizeBytes > 0 && sizeBytes < 2_500_000) return false; // skip tiny previews
            return true;
          });
          if (mp4Files.length === 0) return null;
          // Prefer standard h.264 mp4 without _512kb if available
          mp4Files.sort((a, b) => {
            const aLow = (a.name || '').toLowerCase().includes('512kb') ? 1 : 0;
            const bLow = (b.name || '').toLowerCase().includes('512kb') ? 1 : 0;
            return aLow - bLow;
          });
          const chosen = mp4Files[0].name!;
          const { type, category } = classifyArchiveCategory(title, doc.subject);
          return {
            id: `ia_${id}`,
            name: title.replace(/\s+/g, ' ').slice(0, 100),
            streamUrl: `https://archive.org/download/${encodeURIComponent(id)}/${chosen
              .split('/')
              .map(encodeURIComponent)
              .join('/')}`,
            posterUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
            type,
            category,
            year: doc.year ? String(doc.year).slice(0, 4) : undefined,
            sourceSite: 'archive.org',
          };
        })
      );
      return settled
        .filter(
          (r): r is PromiseFulfilledResult<VodCatalogDto | null> =>
            r.status === 'fulfilled' && r.value !== null
        )
        .map((r) => r.value as VodCatalogDto);
    } catch {
      return [];
    }
  }

  async function fetchIptvCinemaVodFeeds(): Promise<VodCatalogDto[]> {
    const feeds: Array<{ url: string; category: string; type: 'movie' | 'series' }> = [
      { url: 'https://iptv-org.github.io/iptv/categories/movies.m3u', category: 'Canlı Sinema TV', type: 'movie' },
      { url: 'https://iptv-org.github.io/iptv/categories/series.m3u', category: 'Diziler', type: 'series' },
      { url: 'https://iptv-org.github.io/iptv/categories/animation.m3u', category: 'Animasyon & Aile', type: 'movie' },
      { url: 'https://iptv-org.github.io/iptv/categories/comedy.m3u', category: 'Komedi', type: 'movie' },
    ];
    const out: VodCatalogDto[] = [];
    const results = await Promise.allSettled(
      feeds.map(async (f) => {
        const res = await fetchRemotePlaylistOrJson(f.url, AbortSignal.timeout(7000));
        return { feed: f, content: res.content };
      })
    );
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const lines = r.value.content.split(/\r?\n/);
      let pendingName = '';
      let pendingLogo: string | null = null;
      let countForFeed = 0;
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#EXTINF:')) {
          const logoM = /tvg-logo="([^"]*)"/.exec(line);
          pendingLogo = logoM?.[1]?.trim() || null;
          const commaIdx = line.lastIndexOf(',');
          pendingName = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '';
        } else if (!line.startsWith('#') && /^https?:\/\//i.test(line)) {
          if (pendingName && countForFeed < 18) {
            out.push({
              id: `fast_${countForFeed}_${pendingName.slice(0, 12)}`,
              name: pendingName,
              streamUrl: line,
              posterUrl: pendingLogo,
              type: r.value.feed.type,
              category: r.value.feed.category,
              sourceSite: 'iptv-org',
            });
            countForFeed++;
          }
          pendingName = '';
          pendingLogo = null;
        }
      }
    }
    return out;
  }

  async function scrapeVodLinksFromWebPage(pageUrl: string): Promise<VodCatalogDto[]> {
    const normalized = normalizeGithubSourceUrl(pageUrl);
    if (!validateExternalUrl(normalized)) return [];
    const out: VodCatalogDto[] = [];
    try {
      const resp = await fetch(normalized, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(6500),
        headers: { 'User-Agent': DEFAULT_UA, Accept: 'text/html,application/json,text/plain,*/*' },
      });
      if (!resp.ok) return [];
      const body = (await resp.text()).slice(0, 450_000);

      // Case 1: Page itself is an M3U/JSON playlist
      if (body.trimStart().startsWith('#EXTM3U') || body.includes('#EXTINF:')) {
        const lines = body.split(/\r?\n/);
        let curName = '';
        let curLogo: string | null = null;
        let curGroup = '';
        for (const raw of lines) {
          const l = raw.trim();
          if (l.startsWith('#EXTINF:')) {
            curLogo = /tvg-logo="([^"]*)"/.exec(l)?.[1]?.trim() || null;
            curGroup = /group-title="([^"]*)"/.exec(l)?.[1]?.trim() || '';
            const c = l.lastIndexOf(',');
            curName = c >= 0 ? l.slice(c + 1).trim() : '';
          } else if (!l.startsWith('#') && /^https?:\/\//i.test(l) && curName) {
            const cls = classifyArchiveCategory(curName, curGroup);
            out.push({
              id: `web_m3u_${out.length}`,
              name: curName,
              streamUrl: l,
              posterUrl: curLogo,
              type: cls.type,
              category: cls.category,
              sourceSite: new URL(normalized).hostname,
            });
            if (out.length >= 25) break;
          }
        }
        return out;
      }

      // Case 2: HTML page exposing JSON-LD VideoObject, <video><source>, og:video or direct .mp4/.m3u8 URLs
      const pageTitleMatch =
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(body) ||
        /<title>([^<]+)<\/title>/i.exec(body);
      const baseTitle = (pageTitleMatch?.[1] || new URL(normalized).hostname)
        .replace(/\s*[-|–]\s*.*$/, '')
        .trim();
      const ogPoster =
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(body)?.[1] ||
        null;

      const mediaMatches =
        body.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4|webm|mkv)(?:\?[^\s"'<>\\]*)?/gi) ||
        [];
      const seenUrl = new Set<string>();
      for (const rawMedia of mediaMatches) {
        if (seenUrl.has(rawMedia) || !validateExternalUrl(rawMedia)) continue;
        if (/(trailer|frag|preview|thumb|logo|ads)/i.test(rawMedia)) continue;
        seenUrl.add(rawMedia);
        const cls = classifyArchiveCategory(baseTitle, normalized);
        out.push({
          id: `web_html_${out.length}`,
          name: baseTitle || `Web Film ${out.length + 1}`,
          streamUrl: rawMedia,
          posterUrl: ogPoster,
          type: cls.type,
          category: cls.category,
          sourceSite: new URL(normalized).hostname,
        });
        if (out.length >= 10) break;
      }
    } catch {
      // ignore unreachable/protected sites
    }
    return out;
  }

  async function probePlayableVideoUrl(streamUrl: string): Promise<boolean> {
    if (!validateExternalUrl(streamUrl)) return false;
    try {
      const resp = await fetch(streamUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(4500),
        headers: {
          'User-Agent': DEFAULT_UA,
          Range: 'bytes=0-1023',
        },
      });
      if (!resp.ok && resp.status !== 206) return false;
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html')) return false;
      return true;
    } catch {
      return false;
    }
  }

  // Unified VOD Catalog endpoint (Auto-populated so Film & Dizi is never empty)
  app.get('/api/vod/catalog', async (req: Request, res: Response) => {
    const forceRefresh = req.query.refresh === '1';
    if (
      !forceRefresh &&
      vodCatalogCache &&
      Date.now() - vodCatalogCache.fetchedAt < VOD_CATALOG_TTL_MS
    ) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        content: vodCatalogCache.m3uContent,
        count: vodCatalogCache.count,
        aiCount: publishedAiVodItems.size,
        updatedAt: vodCatalogCache.updatedAt,
      });
    }

    const [trArchive, worldArchive, cinemaFeeds] = await Promise.all([
      fetchInternetArchiveVod(
        'mediatype:movies AND (yesilcam OR turkish OR turk OR sinema)',
        14
      ),
      fetchInternetArchiveVod(
        'mediatype:movies AND collection:(feature_films OR classic_tv OR animationandcartoons)',
        18
      ),
      fetchIptvCinemaVodFeeds(),
    ]);

    const combined: VodCatalogDto[] = [
      ...publishedAiVodItems.values(),
      ...trArchive,
      ...worldArchive,
      ...cinemaFeeds,
    ];

    const m3uContent = buildVodM3uFromItems(combined);
    const updatedAt = new Date().toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    vodCatalogCache = {
      fetchedAt: Date.now(),
      m3uContent,
      count: combined.length,
      updatedAt,
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      content: m3uContent,
      count: combined.length,
      aiCount: publishedAiVodItems.size,
      updatedAt,
    });
  });

  // Embedded AI Continuous Film & Dizi Discovery, Scraping, Categorizing & Stream Verification
  app.post('/api/ai/discover-vod', async (req: Request, res: Response) => {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY yapılandırılmamış. Lütfen Settings > Secrets panelinden API anahtarını ekleyin.',
      });
    }

    const rawTopic = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    const attemptNonce =
      typeof req.body?.attemptNonce === 'number' ? req.body.attemptNonce : Date.now();
    const existingSet = new Set<string>(
      Array.isArray(req.body?.existingUrls)
        ? req.body.existingUrls.filter((u: unknown): u is string => typeof u === 'string')
        : []
    );

    const vodAngles = [
      'Türkçe yeşilçam klasikleri, aksiyon, macera ve polisiye filmler',
      'Bilim kurgu, fantastik ve uzay filmleri .mp4 archive vod m3u',
      'Korku, gerilim, gizem ve dram filmleri iptv vod playlist',
      'Animasyon, çizgi film, komedi ve aile filmleri m3u8 mp4',
      'Dünya sineması, belgesel, klasik diziler ve televizyon serileri',
    ];
    const activeAngle = vodAngles[Math.abs(Math.floor(attemptNonce)) % vodAngles.length];
    const userTopic = rawTopic || activeAngle;

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    try {
      // Step 1: Web Search via Gemini Google Search Grounding (no responseSchema!)
      const searchResp = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Kullanıcı isteği: "${userTopic}".
Tüm web genelinde (film arşivleri, archive.org, açık kaynak VOD .m3u / .m3u8 listeleri, sinema ve dizi sayfaları, IPTV VOD JSON dizinleri dahil) doğrudan izlenebilen film ve dizi yayın bağlantılarını (mp4, m3u8, m3u) ve film sayfası adreslerini bul.
Arama odağına uygun Türkçe arama terimleri (2-3 adet) ve bulduğun https:// linklerini açıkça yaz.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          tools: [{ googleSearch: {} }],
        },
      });

      const webSources: Array<{ title: string; uri: string }> = [];
      const seenUri = new Set<string>();
      const candidatePages = new Set<string>();
      const directPlaylistUrls = new Set<string>();
      const rawText = searchResp.text || '';

      const chunks =
        searchResp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      for (const chunk of chunks) {
        const uri = chunk?.web?.uri;
        if (typeof uri === 'string' && validateExternalUrl(uri)) {
          if (!seenUri.has(uri)) {
            seenUri.add(uri);
            webSources.push({ title: chunk?.web?.title || uri, uri });
          }
          const norm = normalizeGithubSourceUrl(uri);
          if (/\.(m3u8?|json)(\?|$)/i.test(norm)) {
            directPlaylistUrls.add(norm);
          } else {
            candidatePages.add(norm);
          }
        }
      }

      for (const pl of extractPlaylistLinksFromHtmlOrText(rawText)) {
        directPlaylistUrls.add(pl);
      }

      const textUrls = rawText.match(/https?:\/\/[^\s"'<>()[\]\\,;{}]+/gi) || [];
      for (let u of textUrls) {
        u = normalizeGithubSourceUrl(u.replace(/[.,;:!?)]+$/, ''));
        if (validateExternalUrl(u) && candidatePages.size < 8) {
          candidatePages.add(u);
        }
      }

      // Build safe Archive.org search query tailored to topic/rotation
      const cleanKeywords = userTopic
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length >= 3)
        .slice(0, 3)
        .join(' OR ');
      const archiveQueries = [
        `mediatype:movies AND (${cleanKeywords || 'sinema OR film OR adventure'})`,
        `mediatype:movies AND collection:(feature_films OR classic_tv OR animationandcartoons)`,
      ];

      // Step 2: Parallel collection from grounded pages, M3U VOD feeds & Archive.org
      const harvested: VodCatalogDto[] = [];
      const crawlTasks = await Promise.allSettled([
        ...[...directPlaylistUrls].slice(0, 5).map((u) => scrapeVodLinksFromWebPage(u)),
        ...[...candidatePages].slice(0, 5).map((u) => scrapeVodLinksFromWebPage(u)),
        fetchInternetArchiveVod(archiveQueries[0], 14),
        fetchInternetArchiveVod(archiveQueries[1], 14),
      ]);

      for (const task of crawlTasks) {
        if (task.status === 'fulfilled') {
          for (const item of task.value) {
            if (!existingSet.has(item.streamUrl)) {
              harvested.push(item);
            }
          }
        }
      }

      // Deduplicate by streamUrl
      const deduped: VodCatalogDto[] = [];
      const seenStream = new Set<string>();
      for (const item of harvested) {
        if (seenStream.has(item.streamUrl)) continue;
        seenStream.add(item.streamUrl);
        deduped.push(item);
        if (deduped.length >= 24) break;
      }

      // Step 3: Probe stream reachability so user gets working connections
      const probeResults = await Promise.allSettled(
        deduped.slice(0, 18).map(async (item) => ({
          item,
          ok: await probePlayableVideoUrl(item.streamUrl),
        }))
      );
      const verifiedVod = probeResults
        .filter(
          (r): r is PromiseFulfilledResult<{ item: VodCatalogDto; ok: boolean }> =>
            r.status === 'fulfilled' && r.value.ok
        )
        .map((r) => r.value.item);

      const finalCandidates = verifiedVod.length > 0 ? verifiedVod : deduped.slice(0, 12);

      // Step 4: Organize, clean Turkish titles & categorize via Gemini structured JSON
      if (finalCandidates.length > 0) {
        try {
          const organizeResp = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: `Aşağıdaki film ve dizi kayıtlarını düzenle, bozuk alt çizgi/kod eklerini temizle ve her birine uygun Türkçe kategori ata:
İzin verilen kategoriler: "Aksiyon & Macera", "Komedi", "Korku & Gerilim", "Bilim Kurgu & Fantastik", "Dram & Romantik", "Animasyon & Aile", "Türk Yapımları", "Diziler", "Belgesel", "Canlı Sinema TV".
Liste:\n${JSON.stringify(
              finalCandidates.map((c, idx) => ({
                idx,
                name: c.name,
                type: c.type,
                category: c.category,
                year: c.year || '',
                sourceSite: c.sourceSite || '',
              }))
            )}`,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  summary: { type: Type.STRING },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        idx: { type: Type.INTEGER },
                        cleanName: { type: Type.STRING },
                        type: { type: Type.STRING },
                        category: { type: Type.STRING },
                      },
                      required: ['idx', 'cleanName', 'type', 'category'],
                    },
                  },
                },
                required: ['summary', 'items'],
              },
            },
          });

          const parsedOrg = JSON.parse((organizeResp.text ?? '{}').trim()) as {
            summary?: string;
            items?: Array<{
              idx: number;
              cleanName: string;
              type: string;
              category: string;
            }>;
          };

          for (const entry of parsedOrg.items || []) {
            const target = finalCandidates[entry.idx];
            if (!target) continue;
            if (entry.cleanName?.trim()) target.name = entry.cleanName.trim();
            if (entry.type === 'series' || entry.type === 'movie') {
              target.type = entry.type;
            }
            if (entry.category?.trim()) target.category = entry.category.trim();
          }

          let addedCount = 0;
          for (const item of finalCandidates) {
            if (!publishedAiVodItems.has(item.streamUrl)) {
              addedCount++;
            }
            publishedAiVodItems.set(item.streamUrl, item);
          }
          vodCatalogCache = null; // invalidate cache so /api/vod/catalog reflects fresh AI additions

          const m3uContent = buildVodM3uFromItems(finalCandidates);
          res.setHeader('Cache-Control', 'no-store');
          return res.json({
            m3uContent,
            addedCount,
            verifiedCount: finalCandidates.length,
            totalAiCount: publishedAiVodItems.size,
            webSources,
            summary:
              parsedOrg.summary ||
              `Yapay zeka ${finalCandidates.length} yeni film/diziyi düzenledi, bağladı ve kategorilere ayırdı.`,
            model: 'gemini-4-hydrogen',
          });
        } catch {
          // Fall through with un-AI-renamed items if schema parse fails
        }
      }

      let addedFallback = 0;
      for (const item of finalCandidates) {
        if (!publishedAiVodItems.has(item.streamUrl)) addedFallback++;
        publishedAiVodItems.set(item.streamUrl, item);
      }
      vodCatalogCache = null;

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        m3uContent: buildVodM3uFromItems(finalCandidates),
        addedCount: addedFallback,
        verifiedCount: finalCandidates.length,
        totalAiCount: publishedAiVodItems.size,
        webSources,
        summary:
          finalCandidates.length > 0
            ? `Yapay zeka web'den ${finalCandidates.length} film/dizi buldu, düzenledi ve bağladı.`
            : 'Yeni film/dizi taraması tamamlandı; mevcut katalog güncel.',
        model: 'gemini-4-hydrogen',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI film/dizi taraması başarısız.';
      return res.status(502).json({ error: msg });
    }
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
    const isExplicitHlsSegment = req.query.hlsseg === '1';
    const lowerUrl = parsed.toString().toLowerCase();
    const lowerCleanUrl = lowerUrl.split('?')[0];
    const isFiniteHlsResource =
      !rangeHeader &&
      (isExplicitHlsSegment ||
        /\.(m3u8|m3u|m4s|key)$/i.test(lowerCleanUrl) ||
        lowerUrl.includes('.m3u8') ||
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
              // Pre-warm upcoming segments asynchronously so slow connections play without freezing
              prefetchHlsSegments(text, finalUrl, ua, referer, origin);
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

      // Handle Shoutcast .pls or plain audio .m3u playlist files transparently
      if (
        contentType.includes('scpls') ||
        contentType.includes('audio/x-mpegurl') ||
        finalUrl.toLowerCase().endsWith('.pls') ||
        finalUrl.toLowerCase().includes('pl=m3u')
      ) {
        const plsText = await upstream.text();
        const plainUrlMatch = plsText.match(/^(https?:\/\/[^\r\n]+)/m);
        const resolvedAudioUrl = extractPlsUrl(plsText) || (plainUrlMatch ? plainUrlMatch[1].trim() : null);
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

  // Batch automatic channel/radio logo finder
  app.post('/api/logos/resolve-batch', async (req: Request, res: Response) => {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = rawItems
      .filter(
        (it: unknown): it is { name: string; isRadio?: boolean; currentLogo?: string | null } =>
          Boolean(it && typeof it === 'object' && typeof (it as { name?: unknown }).name === 'string')
      )
      .slice(0, 3000);

    if (items.length === 0) {
      return res.json({ logos: {}, matchedCount: 0, directorySize: 0 });
    }

    const dir = await getLogoDirectory();
    const logos: Record<string, string> = {};
    let matchedCount = 0;

    for (const item of items) {
      const name = item.name.trim();
      if (!name) continue;
      if (item.currentLogo && !isDeadOrBlockedLogoUrl(item.currentLogo)) {
        continue;
      }
      const candidates = resolveLogoCandidates(dir, name, Boolean(item.isRadio));
      if (candidates.length > 0) {
        logos[name] = candidates[0];
        matchedCount++;
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      logos,
      matchedCount,
      directorySize: dir.globalMap.size,
    });
  });

  // Proxy channel logos cleanly with automatic fallback resolution by channel name & LRU cache
  async function fetchImageBuffer(targetUrl: string): Promise<CachedLogoImage | null> {
    const cached = logoImageCache.get(targetUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
    const parsed = validateExternalUrl(targetUrl);
    if (!parsed) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const upstream = await fetch(parsed.toString(), {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8',
        },
      });
      if (!upstream.ok || !upstream.body) return null;
      const ct = (upstream.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('image/')) return null;
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > 2 * 1024 * 1024) return null;

      const entry: CachedLogoImage = {
        contentType: ct,
        body: buf,
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      };
      if (logoImageCache.size >= MAX_LOGO_IMAGE_CACHE_ITEMS) {
        const oldestKey = logoImageCache.keys().next().value;
        if (oldestKey) logoImageCache.delete(oldestKey);
      }
      logoImageCache.set(targetUrl, entry);
      return entry;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  app.get('/api/logo', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const rawName = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    const isRadio = req.query.radio === '1';

    if (rawUrl && !isDeadOrBlockedLogoUrl(rawUrl)) {
      const img = await fetchImageBuffer(rawUrl);
      if (img) {
        res.setHeader('Content-Type', img.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(img.body);
      }
    }

    if (rawName) {
      try {
        const dir = await getLogoDirectory();
        const candidates = resolveLogoCandidates(dir, rawName, isRadio);
        for (const cand of candidates.slice(0, 3)) {
          const img = await fetchImageBuffer(cand);
          if (img) {
            res.setHeader('Content-Type', img.contentType);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(img.body);
          }
        }
      } catch {
        // Fall through to 404
      }
    }

    return res.status(404).end();
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

      const aiPublishedEntries = [...publishedAiSources.values()]
        .map((src) =>
          src.content
            .replace(/^#EXTM3U[^\r\n]*\r?\n?/im, '')
            .trim()
        )
        .filter(Boolean)
        .join('\n');

      const aiVodEntries =
        publishedAiVodItems.size > 0
          ? buildVodM3uFromItems([...publishedAiVodItems.values()])
              .replace(/^#EXTM3U[^\r\n]*\r?\n?/im, '')
              .trim()
          : '';

      const combined = `${headerInjected.trimEnd()}\n${radioEntries}\n${aiPublishedEntries}\n${aiVodEntries}\n`;
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

  // Collect ALL project source, config, workflow, and public asset files completely
  async function collectAllProjectFiles(): Promise<Array<{ relPath: string; data: Buffer }>> {
    const filesToPack: Array<{ relPath: string; data: Buffer }> = [];
    const ignoredDirs = new Set([
      'node_modules',
      'dist',
      '.git',
      '.aistudio',
      'android-apk',
      'tmp',
    ]);
    const ignoredFiles = new Set(['.DS_Store', 'Thumbs.db']);

    async function walk(dir: string, relPrefix: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (ignoredFiles.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (ignoredDirs.has(entry.name)) continue;
          await walk(full, rel);
        } else if (entry.isFile()) {
          const data = await fs.readFile(full);
          filesToPack.push({ relPath: rel, data });
        }
      }
    }

    await walk(__dirname, '');
    return filesToPack;
  }

  // Standard CRC-32 helper for pure-Node PKZIP export
  const crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crc32Table[i] = c >>> 0;
  }
  function computeCrc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crc32Table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Export complete source code archive (.zip) with all project files
  app.get('/api/export/source.zip', async (_req: Request, res: Response) => {
    try {
      const filesToPack = await collectAllProjectFiles();
      const localParts: Buffer[] = [];
      const centralParts: Buffer[] = [];
      let offset = 0;

      for (const item of filesToPack) {
        const nameBuf = Buffer.from(item.relPath, 'utf-8');
        const crc = computeCrc32(item.data);
        const compressed = deflateRawSync(item.data, { level: 6 });

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
        localHeader.writeUInt16LE(8, 8); // deflate
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(item.data.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuf, compressed);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(compressed.length, 20);
        centralHeader.writeUInt32LE(item.data.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralParts.push(centralHeader, nameBuf);
        offset += localHeader.length + nameBuf.length + compressed.length;
      }

      const centralDir = Buffer.concat(centralParts);
      const endRecord = Buffer.alloc(22);
      endRecord.writeUInt32LE(0x06054b50, 0);
      endRecord.writeUInt16LE(0, 4);
      endRecord.writeUInt16LE(0, 6);
      endRecord.writeUInt16LE(filesToPack.length, 8);
      endRecord.writeUInt16LE(filesToPack.length, 10);
      endRecord.writeUInt32LE(centralDir.length, 12);
      endRecord.writeUInt32LE(offset, 16);
      endRecord.writeUInt16LE(0, 20);

      const zipBuf = Buffer.concat([...localParts, centralDir, endRecord]);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="eymen-tv-radyo-tam-kaynak.zip"'
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.send(zipBuf);
    } catch {
      return res.status(500).json({ error: 'ZIP arşivi oluşturulamadı.' });
    }
  });

  // Export complete source code archive (.tar.gz) with all project files
  app.get('/api/export/source.tar.gz', async (_req: Request, res: Response) => {
    try {
      const filesToPack = await collectAllProjectFiles();

      const blocks: Buffer[] = [];
      for (const item of filesToPack) {
        const header = Buffer.alloc(512, 0);
        let namePart = item.relPath;
        let prefixPart = '';
        if (Buffer.byteLength(item.relPath, 'utf-8') > 100) {
          const slashIdx = item.relPath.lastIndexOf('/');
          if (slashIdx > 0) {
            prefixPart = item.relPath.slice(0, slashIdx);
            namePart = item.relPath.slice(slashIdx + 1);
          }
        }
        const nameBytes = Buffer.from(namePart, 'utf-8');
        nameBytes.copy(header, 0, 0, Math.min(nameBytes.length, 100));
        if (prefixPart) {
          const prefixBytes = Buffer.from(prefixPart, 'utf-8');
          prefixBytes.copy(header, 345, 0, Math.min(prefixBytes.length, 155));
        }
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
