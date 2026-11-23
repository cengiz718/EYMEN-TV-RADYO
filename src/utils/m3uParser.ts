import type { Channel } from '../types/channel';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const DEFAULT_REFERER = 'https://vavoo.to/';
const DEFAULT_ORIGIN = 'https://vavoo.to';

const LOGO_REGEX = /tvg-logo="([^"]*)"/;
const GROUP_REGEX = /group-title="([^"]*)"/;
const NAME_REGEX = /tvg-name="([^"]*)"/;

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash;
}

export function detectQualityLabel(name: string): string | undefined {
  const u = name.toUpperCase();
  if (/\b(4K|UHD|2160P)\b/.test(u)) return '4K';
  if (/\b(FHD|1080P|FULL\s*HD)\b/.test(u)) return 'FHD';
  if (/\b(HD|720P)\b/.test(u)) return 'HD';
  if (/\b(SD|480P)\b/.test(u)) return 'SD';
  return undefined;
}

function detectRadio(name: string, group: string): boolean {
  const upper = `${name} ${group}`.toUpperCase();
  const radioKeywords = [
    'RADYO',
    'RADIO',
    ' FM',
    'FM ',
    'POWERTURK',
    'POWER LOVE',
    'POWER DANCE',
    'NUMBER 1 ASK',
    'NUMBER 1 DAMAR',
    'NUMBER 1 DANCE',
    'PAL STATION',
    'RETRO T',
    'NOSTALJI',
    'AKUSTIK',
    'FASIL',
    'SLOW KARADENIZ',
    'AHMET KAYA',
    'MUSLUM GURSES',
    'SEZEN AKSU',
    'TARKAN',
    'ZARA',
    'CENGIZ KURTOGLU',
    'MAHSUN KIRMIZIGUL',
    'YILDIZ TILBE',
    'ZERRIN OZER',
    'SELDA BAGCAN',
    'SONER ARICA',
    'VINTAGE MUSIC',
    'HAVIN FM',
    'AZADI FM',
    'DENGE CUDI',
    'GOVEND',
  ];
  return radioKeywords.some((kw) => upper.includes(kw));
}

function classifyChannel(name: string, originalGroup: string, isRadio: boolean): string {
  const uName = name.toUpperCase();
  const uCombined = `${name} ${originalGroup}`.toUpperCase();

  const kurdishKeywords = [
    'TRT KURD',
    'KURDI',
    'KURDÎ',
    'KURDISTAN',
    'KURDSAT',
    'RUDAW',
    'ZAGROS',
    'WAAR',
    'NRT ',
    'NRT2',
    'AVA MEDIA',
    'AVAR TV',
    'CHANNEL8',
    'CHANNEL 8',
    'STERK',
    'JIN TV',
    'MED MUZIK',
    'MED NEWS',
    'ARYEN',
    'CIRA TV',
    'KOMALA',
    'AFARIN',
    'MIXKURDY',
    'KURD CHANNEL',
    'RONAHI',
    '4KURD',
    'KURD1',
    'HAVIN FM',
    'AZADI FM',
    'DENGE CUDI',
    'AXA ROJAVA',
    'SPEDA',
    'GOVEND',
    'SIRVAN PERWER',
    'ŞİRVAN PERWER',
    'MEZOPOTAMYA',
    'PAYAM TV',
    'KURDISH',
    'KÜRTÇE',
  ];
  if (kurdishKeywords.some((kw) => uCombined.includes(kw))) {
    return 'Kürtçe Yayınlar';
  }

  if (isRadio) return 'Radyo & Müzik';

  const sporKeywords = [
    'SPOR',
    'SPORT',
    'SPORTS',
    'FUTBOL',
    'FOOTBALL',
    'SOCCER',
    'EUROSPORT',
    'ESPN',
    'DAZN',
    'BUNDESLIGA',
    'FORMULA 1',
    'MAGESPORT',
    'MAGENTA SPORT',
    'DYN SPORT',
    'MOTORSPORT',
    'BEIN',
    'EXXEN',
    'TIVIBU',
    'TABII',
    'NBA',
    'UFC',
    'FB TV',
    'GS TV',
    'GALATASARAY',
    'TJK',
    'TAY',
    'IDMAN',
    'SARAN',
  ];
  if (sporKeywords.some((kw) => uCombined.includes(kw))) return 'Spor';

  const belgeselKeywords = [
    'BELGESEL',
    'NAT GEO',
    'NATIONAL',
    'DISCOVERY',
    'HISTORY',
    'VIASAT',
    'BBC EARTH',
    'LOVE NATURE',
    'ANIMAL',
    'YABAN',
    'CIFTCI',
    'AGRO',
    'TARIH',
    'DOCU',
    'DOKU',
    'DOCUMENTARY',
    'WILDLIFE',
    'SCIENCE',
    'TERRA X',
    'SPIEGEL TV',
    'ZDF INFO',
    'ZDFINFO',
    'ARTE',
    '3SAT',
    'IZ TV',
    'TLC',
    'DMAX',
    '24 KITCHEN',
  ];
  if (belgeselKeywords.some((kw) => uCombined.includes(kw))) return 'Belgesel & Doğa';

  const cocukKeywords = [
    'COCUK',
    'ÇOCUK',
    'OCUK',
    'KIDS',
    'KIKA',
    'SUPER RTL',
    'TOGGO',
    'CARTOON',
    'ANIMATION',
    'ANIME',
    'DISNEY',
    'NICK',
    'BABY',
    'MINIKA',
    'M N KA',
    'PEPE',
    'NILOYA',
    'KELOGLAN',
    'KRAL SAKIR',
    'POKEMON',
    'BOOMERANG',
    'MASAL',
    'EBA',
    'DA VINC',
    'CBEEBIES',
    'DUCK',
    'PISI',
    'KUKULI',
  ];
  if (cocukKeywords.some((kw) => uCombined.includes(kw))) return 'Çocuk & Eğitim';

  const sinemaKeywords = [
    'SINEMA',
    'SİNEMA',
    'S NEMA',
    'MOVIE',
    'MOVIES',
    'CINEMA',
    'CINE',
    'KINO',
    'FILM',
    'BLUETV',
    'NETFLIX',
    'SALON',
    'BOX',
    'FIX',
    'PROTURK',
    'MAX ',
    'ENO ',
    'YESILCAM',
    'YEŞILÇAM',
    'FX',
    'SYFY',
    'WARNER',
    'UNIVERSAL',
    'TNT',
    '13TH STREET',
    'DIZI',
    'SERIES',
  ];
  if (sinemaKeywords.some((kw) => uCombined.includes(kw))) return 'Sinema & Dizi';

  const haberKeywords = [
    'HABER',
    'NEWS',
    'NACHRICHTEN',
    'TAGESSCHAU',
    'WELT',
    'N-TV',
    'PHOENIX',
    'NTV',
    'CNN',
    'EURONEWS',
    'BBC WORLD',
    'HALK',
    'SOZCU',
    'SZC',
    'TELE 1',
    'KRT',
    'TRT',
    'A HABER',
    'BLOOMBERG',
    'EKOTURK',
    'EKO TURK',
    'TBMM',
    'ULUSAL',
    'LIDER',
    'FLASH',
    'ÜLKE',
    'ULKE',
    'BENGU',
    'BENG T',
    'TÜRKHABER',
  ];
  if (
    haberKeywords.some((kw) => uCombined.includes(kw)) &&
    !uName.includes('BELGESEL') &&
    !uName.includes('COCUK') &&
    !uName.includes('MUZIK')
  ) {
    return 'Haber & Ulusal';
  }

  const ulusalKeywords = [
    'ATV',
    'KANAL D',
    'SHOW',
    'STAR',
    'NOW',
    'FOX',
    'TV 8',
    'TV8',
    'BEYAZ',
    '360',
    'TEVE',
    'KANAL 7',
  ];
  if (ulusalKeywords.some((kw) => uName.includes(kw))) return 'Haber & Ulusal';

  return 'Yerel & Diğer';
}

export function parseM3u(content: string): Channel[] {
  const channels: Channel[] = [];
  const lines = content.split(/\r?\n/);

  let globalUserAgent = DEFAULT_UA;
  let globalReferer = DEFAULT_REFERER;
  let globalOrigin = DEFAULT_ORIGIN;

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
      currentName = titleFromComma || nameMatch?.[1]?.trim() || `Kanal ${index + 1}`;
    } else if (!line.startsWith('#') && (line.startsWith('http://') || line.startsWith('https://'))) {
      const name = currentName ?? `Kanal ${index + 1}`;
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

      const isRadio = detectRadio(name, currentGroup);
      const smartCategory = classifyChannel(name, currentGroup, isRadio);

      channels.push({
        id: `${index}_${hashString(name)}`,
        name,
        streamUrl: cleanUrl,
        logoUrl: currentLogo,
        originalGroup: currentGroup,
        smartCategory,
        isRadio,
        qualityLabel: detectQualityLabel(name),
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

  return channels;
}

export function normalizeInputUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  const clean = trimmed.replace(/^\/+/, '');
  const preferHttps =
    /^(?:raw\.githubusercontent\.com|github\.com|gist\.github\.com|[\w.-]+\.workers\.dev)/i.test(
      clean
    );
  return `${preferHttps ? 'https' : 'http'}://${clean}`;
}

export function normalizeGithubRawUrl(rawUrl: string): string {
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

export function parseJsonPlaylist(
  jsonText: string,
  fallbackGroup = 'Genel'
): Channel[] {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const channels: Channel[] = [];
    let index = 0;

    const pushEntry = (item: Record<string, unknown>, groupOverride?: string) => {
      const rawUrl =
        item.url ??
        item.streamUrl ??
        item.stream_url ??
        item.stream ??
        item.link ??
        item.source ??
        item.file ??
        item.m3u8;
      const cleanUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
      if (!cleanUrl || (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://'))) {
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
          ? rawName.trim()
          : `Kanal ${index + 1}`;
      const rawGroup =
        item.group ??
        item.category ??
        item.category_name ??
        item.kategori ??
        item.group_title ??
        groupOverride ??
        fallbackGroup;
      const currentGroup =
        typeof rawGroup === 'string' && rawGroup.trim() ? rawGroup.trim() : fallbackGroup;
      const rawLogo =
        item.logo ??
        item.logoUrl ??
        item.logo_url ??
        item.tvg_logo ??
        item.icon ??
        item.image ??
        '';
      const logoUrl =
        typeof rawLogo === 'string' && rawLogo.trim().startsWith('http')
          ? rawLogo.trim()
          : null;

      const isRadio = detectRadio(name, currentGroup);
      const smartCategory = classifyChannel(name, currentGroup, isRadio);

      channels.push({
        id: `json_${index}_${hashString(`${name}|${cleanUrl}`)}`,
        name,
        streamUrl: cleanUrl,
        logoUrl,
        originalGroup: currentGroup,
        smartCategory,
        isRadio,
        qualityLabel: detectQualityLabel(name),
        userAgent: typeof item.userAgent === 'string' && item.userAgent ? item.userAgent : DEFAULT_UA,
        referer: typeof item.referer === 'string' ? item.referer : DEFAULT_REFERER,
        origin: typeof item.origin === 'string' ? item.origin : DEFAULT_ORIGIN,
        source: 'github-json',
      });
      index++;
    };

    const walk = (arr: unknown[], groupOverride?: string) => {
      for (const el of arr) {
        if (el && typeof el === 'object' && !Array.isArray(el)) {
          pushEntry(el as Record<string, unknown>, groupOverride);
        }
      }
    };

    if (Array.isArray(parsed)) {
      walk(parsed);
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
      for (const k of listKeys) {
        if (Array.isArray(obj[k])) {
          walk(obj[k] as unknown[]);
          handled = true;
          break;
        }
      }
      if (!handled) {
        for (const [grp, val] of Object.entries(obj)) {
          if (Array.isArray(val)) walk(val, grp);
        }
      }
    }

    return channels;
  } catch {
    return [];
  }
}

export function parseUniversalPlaylist(
  content: string,
  fallbackGroup = 'Genel'
): Channel[] {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const jsonParsed = parseJsonPlaylist(content, fallbackGroup);
    if (jsonParsed.length > 0) return jsonParsed;
  }
  return parseM3u(content);
}

export function mergeChannelLists(
  primary: Channel[],
  extras: Channel[]
): Channel[] {
  if (extras.length === 0) return primary;
  const seenUrls = new Set(primary.map((c) => c.streamUrl.trim()));
  const byNameIdx = new Map<string, number>();
  const merged = primary.map((ch, idx) => {
    byNameIdx.set(ch.name.toLocaleLowerCase('tr-TR').trim(), idx);
    return ch;
  });

  for (const ch of extras) {
    const urlKey = ch.streamUrl.trim();
    if (!urlKey || seenUrls.has(urlKey)) continue;
    seenUrls.add(urlKey);

    const nameKey = ch.name.toLocaleLowerCase('tr-TR').trim();
    const existingIdx = byNameIdx.get(nameKey);
    if (existingIdx !== undefined) {
      const existing = merged[existingIdx];
      const existingBackups = existing.backupUrls ?? [];
      if (!existingBackups.includes(urlKey) && existingBackups.length < 4) {
        merged[existingIdx] = {
          ...existing,
          backupUrls: [...existingBackups, urlKey],
        };
      }
      continue;
    }

    byNameIdx.set(nameKey, merged.length);
    merged.push(ch);
  }
  return merged;
}
