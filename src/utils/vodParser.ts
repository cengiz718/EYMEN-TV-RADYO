import type { Channel, VodItem } from '../types/channel';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const LOGO_REGEX = /tvg-logo="([^"]*)"/;
const GROUP_REGEX = /group-title="([^"]*)"/;
const NAME_REGEX = /tvg-name="([^"]*)"/;

function hashStr(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash;
}

function cleanGroupTitle(raw: string): string {
  return raw
    .replace(/^(VOD|FILM|FİLM|DİZİ|DIZI|SERIES|MOVIE|MOVIES)\s*[·|:/-]\s*/i, '')
    .replace(/^(TR:|TR\s+|TURKEY\s*[|:-]?\s*)/i, '')
    .replace(/^[\W_]+|[\W_]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectVodType(name: string, group: string, url: string): 'movie' | 'series' {
  const combined = `${name} ${group} ${url}`.toUpperCase();
  if (
    /S\d{1,2}\s*[E\.x-]?\s*E?\d{1,3}/i.test(name) ||
    /\d+\.\s*(SEZON|BOLUM|BÖLÜM)/i.test(name) ||
    /\/SERIES\//i.test(url) ||
    /(DİZİ|DIZI|SERIES|SEZON|BOLUM|BÖLÜM)/.test(combined)
  ) {
    return 'series';
  }
  return 'movie';
}

export function buildAutoVodCategory(
  name: string,
  originalGroup: string,
  type: 'movie' | 'series'
): string {
  const cleanedGroup = cleanGroupTitle(originalGroup);
  const genericGroups = new Set([
    '',
    'GENEL',
    'VOD',
    'FILM',
    'FİLM',
    'FILMLER',
    'FİLMLER',
    'DIZI',
    'DİZİ',
    'DIZILER',
    'DİZİLER',
    'MOVIE',
    'MOVIES',
    'SERIES',
    'SINEMA',
    'SİNEMA',
  ]);

  if (cleanedGroup && !genericGroups.has(cleanedGroup.toLocaleUpperCase('tr-TR'))) {
    // Normalize common group spellings cleanly
    return cleanedGroup;
  }

  const text = `${name} ${originalGroup}`.toLocaleLowerCase('tr-TR');

  if (/(aksiyon|macera|action|savaş|savas|dövüş|dovus|suç|suc|polisiye)/.test(text)) {
    return 'Aksiyon & Macera';
  }
  if (/(komedi|comedy|mizah|kahkaha|recep|şaban|saban|hababam|güldür)/.test(text)) {
    return 'Komedi';
  }
  if (/(korku|gerilim|horror|thriller|gizem|vahşet)/.test(text)) {
    return 'Korku & Gerilim';
  }
  if (/(bilim kurgu|sci-fi|fantastik|uzay|marvel|dc|avengers|star wars|harry potter)/.test(text)) {
    return 'Bilim Kurgu & Fantastik';
  }
  if (/(animasyon|çizgi|cizgi|aile|çocuk|cocuk|pixar|disney|anime)/.test(text)) {
    return 'Animasyon & Aile';
  }
  if (/(belgesel|documentary|tarih|doğa|doga|discovery|nat geo)/.test(text)) {
    return 'Belgesel';
  }
  if (/(yeşilçam|yesilcam|türk|turk|yerli|kemal sunal|şener şen|cüneyt arkın)/.test(text)) {
    return 'Türk Yapımları';
  }
  if (/(dram|aşk|ask|romantik|duygusal|drama)/.test(text)) {
    return 'Dram & Romantik';
  }
  if (/(4k|uhd)/.test(text)) {
    return '4K Ultra HD';
  }

  return type === 'series' ? 'Diziler' : 'Genel Filmler';
}

export function extractYear(name: string): string | undefined {
  const m = name.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : undefined;
}

export function extractSeasonEpisode(name: string): {
  seasonEpisode?: string;
  seriesTitle?: string;
} {
  const sxe = name.match(/^(.*?)[\s._-]+(S\d{1,2}\s*E\d{1,3})\b/i);
  if (sxe) {
    return {
      seriesTitle: sxe[1].trim(),
      seasonEpisode: sxe[2].replace(/\s+/g, '').toUpperCase(),
    };
  }
  const trEp = name.match(/^(.*?)[\s._-]+(\d+)\.\s*Sezon\s*(\d+)\.\s*B[oö]l[uü]m/i);
  if (trEp) {
    return {
      seriesTitle: trEp[1].trim(),
      seasonEpisode: `S${trEp[2].padStart(2, '0')}E${trEp[3].padStart(2, '0')}`,
    };
  }
  return {};
}

export function parseVodM3u(content: string): VodItem[] {
  const items: VodItem[] = [];
  const lines = content.split(/\r?\n/);

  let globalUserAgent = DEFAULT_UA;
  let globalReferer = '';
  let globalOrigin = '';

  let currentName: string | null = null;
  let currentLogo: string | null = null;
  let currentGroup = 'Genel';
  let itemUserAgent: string | null = null;
  let itemReferer: string | null = null;
  let itemOrigin: string | null = null;
  let index = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-USER-AGENT:')) {
      globalUserAgent = line.slice('#EXT-X-USER-AGENT:'.length).trim();
    } else if (line.startsWith('#EXT-X-REFERER:')) {
      globalReferer = line.slice('#EXT-X-REFERER:'.length).trim();
    } else if (line.startsWith('#EXT-X-ORIGIN:')) {
      globalOrigin = line.slice('#EXT-X-ORIGIN:'.length).trim();
    } else if (line.startsWith('#EXTVLCOPT:http-user-agent=')) {
      itemUserAgent = line.slice('#EXTVLCOPT:http-user-agent='.length).trim();
    } else if (line.startsWith('#EXTVLCOPT:http-referrer=')) {
      itemReferer = line.slice('#EXTVLCOPT:http-referrer='.length).trim();
    } else if (line.startsWith('#EXTVLCOPT:http-origin=')) {
      itemOrigin = line.slice('#EXTVLCOPT:http-origin='.length).trim();
    } else if (line.startsWith('#EXTINF:')) {
      const logoMatch = LOGO_REGEX.exec(line);
      currentLogo = logoMatch?.[1]?.trim() || null;

      const groupMatch = GROUP_REGEX.exec(line);
      currentGroup = groupMatch?.[1]?.trim() || 'Genel';

      const commaIdx = line.lastIndexOf(',');
      const titleFromComma =
        commaIdx !== -1 && commaIdx + 1 < line.length
          ? line.slice(commaIdx + 1).trim()
          : '';
      const nameMatch = NAME_REGEX.exec(line);
      currentName = titleFromComma || nameMatch?.[1]?.trim() || `İçerik ${index + 1}`;
    } else if (!line.startsWith('#') && (line.startsWith('http://') || line.startsWith('https://'))) {
      const name = currentName ?? `İçerik ${index + 1}`;
      const pipeIdx = line.indexOf('|');
      const cleanUrl = pipeIdx !== -1 ? line.slice(0, pipeIdx).trim() : line;

      let pipeUa: string | null = null;
      let pipeRef: string | null = null;
      let pipeOrig: string | null = null;

      if (pipeIdx !== -1) {
        const paramString = line.slice(pipeIdx + 1);
        for (const param of paramString.split('&')) {
          const eqIdx = param.indexOf('=');
          if (eqIdx !== -1) {
            const key = param.slice(0, eqIdx).toLowerCase();
            const val = param.slice(eqIdx + 1);
            if (key === 'user-agent') pipeUa = val;
            else if (key === 'referer' || key === 'referrer') pipeRef = val;
            else if (key === 'origin') pipeOrig = val;
          }
        }
      }

      const type = detectVodType(name, currentGroup, cleanUrl);
      const autoCategory = buildAutoVodCategory(name, currentGroup, type);
      const year = extractYear(name);
      const { seasonEpisode, seriesTitle } = extractSeasonEpisode(name);

      items.push({
        id: `vod_${index}_${hashStr(name + cleanUrl)}`,
        name,
        streamUrl: cleanUrl,
        posterUrl: currentLogo,
        type,
        autoCategory,
        originalGroup: currentGroup,
        year,
        seasonEpisode,
        seriesTitle,
        userAgent: pipeUa ?? itemUserAgent ?? globalUserAgent,
        referer: pipeRef ?? itemReferer ?? globalReferer,
        origin: pipeOrig ?? itemOrigin ?? globalOrigin,
      });

      index++;
      currentName = null;
      currentLogo = null;
      itemUserAgent = null;
      itemReferer = null;
      itemOrigin = null;
    }
  }

  return items;
}

export function vodItemToChannel(item: VodItem): Channel {
  return {
    id: item.id,
    name: item.name,
    streamUrl: item.streamUrl,
    logoUrl: item.posterUrl,
    originalGroup: item.originalGroup,
    smartCategory: item.autoCategory,
    isRadio: false,
    isVod: true,
    userAgent: item.userAgent,
    referer: item.referer,
    origin: item.origin,
    source: 'vod',
  };
}
