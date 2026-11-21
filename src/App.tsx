import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CloudDownload,
  Film,
  Heart,
  LayoutGrid,
  Moon,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Tv,
  X,
} from 'lucide-react';
import {
  CATEGORIES,
  DEFAULT_APP_SETTINGS,
  DEFAULT_EXTERNAL_SOURCES,
  type ActiveTab,
  type AppSettings,
  type AspectMode,
  type CategoryName,
  type Channel,
  type EpgNowNext,
  type ExternalListSource,
  type MultiScreenLayout,
  type VodItem,
  type VodProgressEntry,
  type XtreamSeriesEntry,
  type XtreamVodAuth,
} from './types/channel';
import {
  mergeChannelLists,
  normalizeGithubRawUrl,
  parseM3u,
  parseUniversalPlaylist,
} from './utils/m3uParser';
import { parseVodM3u, vodItemToChannel } from './utils/vodParser';
import { computeEpgProgress, formatEpgTime, lookupEpgForChannel } from './utils/epg';
import { VideoPlayerSurface } from './components/VideoPlayerSurface';
import { MultiScreenGrid } from './components/MultiScreenGrid';
import { ChannelRowItem } from './components/ChannelRowItem';
import { OnlineRadioTab } from './components/OnlineRadioTab';
import { VodSectionTab } from './components/VodSectionTab';
import { VodImportModal } from './components/VodImportModal';
import { SettingsTab } from './components/SettingsTab';
import { PlaylistUpdateModal } from './components/PlaylistUpdateModal';
import { SleepTimerModal } from './components/SleepTimerModal';
import { EpgScheduleModal } from './components/EpgScheduleModal';

const STORAGE_FAVS_KEY = 'optis_favorites';
const STORAGE_URL_KEY = 'optis_m3u_url';
const STORAGE_MANDATORY_KEY = 'optis_mandatory_update';
const STORAGE_CUSTOM_PLAYLIST_KEY = 'optis_custom_playlist';
const STORAGE_LAST_UPDATED_KEY = 'optis_last_updated_at';
const STORAGE_SETTINGS_KEY = 'optis_app_settings';
const STORAGE_LAST_CHANNEL_KEY = 'optis_last_channel';
const STORAGE_LAST_CATEGORY_KEY = 'optis_last_category';
const STORAGE_EXTERNAL_SOURCES_KEY = 'eymen_external_sources_v1';
const STORAGE_EXTERNAL_CACHE_KEY = 'eymen_external_cache_v1';
const STORAGE_VOD_PLAYLIST_KEY = 'eymen_vod_playlist';
const STORAGE_VOD_URL_KEY = 'eymen_vod_url';
const STORAGE_VOD_SERIES_KEY = 'eymen_vod_xtream_series';
const STORAGE_VOD_AUTH_KEY = 'eymen_vod_xtream_auth';
const STORAGE_VOD_PROGRESS_KEY = 'eymen_vod_progress';

interface OnlineRadioDto {
  id: string;
  name: string;
  streamUrl: string;
  logoUrl: string | null;
  tags: string;
  codec: string;
  bitrate: number;
  country: string;
}

function mapOnlineRadioToChannel(r: OnlineRadioDto): Channel {
  return {
    id: r.id,
    name: r.name,
    streamUrl: r.streamUrl,
    logoUrl: r.logoUrl,
    originalGroup: r.country || 'Türkiye',
    smartCategory: 'Radyo & Müzik',
    isRadio: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    referer: '',
    origin: '',
    codec: r.codec,
    bitrate: r.bitrate,
    tags: r.tags,
    source: 'online-radio',
  };
}

function readInitialFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_FAVS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function readInitialSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

function readInitialCategory(hidden: CategoryName[]): CategoryName {
  try {
    const saved = localStorage.getItem(STORAGE_LAST_CATEGORY_KEY) as CategoryName | null;
    if (saved && CATEGORIES.includes(saved) && !hidden.includes(saved)) {
      return saved;
    }
  } catch {
    // ignore
  }
  return 'Tümü';
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(readInitialSettings);
  const [activeTab, setActiveTab] = useState<ActiveTab>('channels');

  const [m3uChannels, setM3uChannels] = useState<Channel[]>([]);
  const [onlineRadios, setOnlineRadios] = useState<Channel[]>([]);
  const [globalRadios, setGlobalRadios] = useState<Channel[]>([]);
  const [isLoadingRadios, setIsLoadingRadios] = useState(false);

  const [epgMap, setEpgMap] = useState<Record<string, EpgNowNext>>({});
  const [epgChannelCount, setEpgChannelCount] = useState(0);
  const [isLoadingEpg, setIsLoadingEpg] = useState(false);
  const [showEpgDialog, setShowEpgDialog] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<CategoryName>(() =>
    readInitialCategory(readInitialSettings().hiddenCategories)
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(readInitialFavorites);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSyncingExternal, setIsSyncingExternal] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [pauseSignal, setPauseSignal] = useState(0);

  // External GitHub JSON / M3U bulk sources (auto-synced & merged into channel list)
  const [externalSources, setExternalSources] = useState<ExternalListSource[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_EXTERNAL_SOURCES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ExternalListSource[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return DEFAULT_EXTERNAL_SOURCES;
  });
  const [externalChannelsMap, setExternalChannelsMap] = useState<Record<string, Channel[]>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_EXTERNAL_CACHE_KEY);
      if (raw) {
        return JSON.parse(raw) as Record<string, Channel[]>;
      }
    } catch {
      // ignore
    }
    return {};
  });

  // Film & Dizi (VOD) state with automatic category generation & resume progress
  const [vodItems, setVodItems] = useState<VodItem[]>(() => {
    try {
      const cached = localStorage.getItem(STORAGE_VOD_PLAYLIST_KEY);
      return cached ? parseVodM3u(cached) : [];
    } catch {
      return [];
    }
  });
  const [savedVodUrl, setSavedVodUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_VOD_URL_KEY) || '';
    } catch {
      return '';
    }
  });
  const [xtreamSeries, setXtreamSeries] = useState<XtreamSeriesEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_VOD_SERIES_KEY);
      return raw ? (JSON.parse(raw) as XtreamSeriesEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [xtreamVodAuth, setXtreamVodAuth] = useState<XtreamVodAuth | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_VOD_AUTH_KEY);
      return raw ? (JSON.parse(raw) as XtreamVodAuth) : null;
    } catch {
      return null;
    }
  });
  const [vodProgressMap, setVodProgressMap] = useState<Record<string, VodProgressEntry>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_VOD_PROGRESS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, VodProgressEntry>) : {};
    } catch {
      return {};
    }
  });
  const [showVodModal, setShowVodModal] = useState(false);

  // Multi-Screen (Beleş TiVi 2'li / 4'lü Ekran) State
  const [multiScreenLayout, setMultiScreenLayout] = useState<MultiScreenLayout>(1);
  const [multiSlots, setMultiSlots] = useState<(Channel | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [audioSlotIndex, setAudioSlotIndex] = useState(0);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aspectMode, setAspectMode] = useState<AspectMode>(
    () => readInitialSettings().defaultAspectMode
  );
  const [showUrlDialog, setShowUrlDialog] = useState(false);
  const [showSleepDialog, setShowSleepDialog] = useState(false);
  const [visibleCount, setVisibleCount] = useState(100);

  const [savedUrl, setSavedUrl] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('m3u');
    if (fromQuery) {
      try {
        localStorage.setItem(STORAGE_URL_KEY, fromQuery);
      } catch {
        // ignore
      }
      return fromQuery;
    }
    return localStorage.getItem(STORAGE_URL_KEY) || '';
  });

  const [mandatoryAutoUpdate, setMandatoryAutoUpdate] = useState<boolean>(() => {
    const raw = localStorage.getItem(STORAGE_MANDATORY_KEY);
    return raw === null ? true : raw === 'true';
  });

  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_LAST_UPDATED_KEY)
  );

  const sleepIntervalRef = useRef<number | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  // Sync HTML data-theme attribute immediately
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Visible categories honoring Kategori Gizleme
  const visibleCategories = useMemo(() => {
    const hiddenSet = new Set(settings.hiddenCategories);
    return CATEGORIES.filter((c) => c === 'Tümü' || c === 'Favoriler' || !hiddenSet.has(c));
  }, [settings.hiddenCategories]);

  useEffect(() => {
    if (!visibleCategories.includes(selectedCategory)) {
      setSelectedCategory('Tümü');
    }
  }, [visibleCategories, selectedCategory]);

  // Persist last selected category & channel (Smart Resume)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_LAST_CATEGORY_KEY, selectedCategory);
    } catch {
      // ignore
    }
  }, [selectedCategory]);

  useEffect(() => {
    if (!currentChannel) return;
    try {
      localStorage.setItem(STORAGE_LAST_CHANNEL_KEY, currentChannel.name);
    } catch {
      // ignore
    }
  }, [currentChannel]);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      if (partial.defaultAspectMode) {
        setAspectMode(partial.defaultAspectMode);
      }
      return next;
    });
  }, []);

  const loadOnlineEpg = useCallback(
    async (customUrl?: string, forceRefresh = false) => {
      setIsLoadingEpg(true);
      try {
        const params = new URLSearchParams();
        const urlToUse = customUrl !== undefined ? customUrl : settings.epgUrl;
        if (urlToUse.trim()) params.set('url', urlToUse.trim());
        if (forceRefresh) params.set('refresh', '1');
        const res = await fetch(`/api/epg/now?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = (await res.json()) as {
          channels?: Record<string, EpgNowNext>;
          channelCount?: number;
        };
        if (res.ok && data.channels) {
          setEpgMap(data.channels);
          setEpgChannelCount(data.channelCount || Object.keys(data.channels).length);
        }
      } catch {
        // Keep existing EPG map if temporarily unreachable
      } finally {
        setIsLoadingEpg(false);
      }
    },
    [settings.epgUrl]
  );

  const allChannels = useMemo(() => {
    const extraLists: Channel[] = [];
    for (const src of externalSources) {
      if (src.enabled && Array.isArray(externalChannelsMap[src.id])) {
        extraLists.push(...externalChannelsMap[src.id]);
      }
    }
    const baseMerged = mergeChannelLists(m3uChannels, extraLists);
    if (!settings.mergeOnlineRadiosToChannels || onlineRadios.length === 0) {
      return baseMerged;
    }
    const existingNames = new Set(
      baseMerged.map((c) => c.name.toLocaleLowerCase('tr-TR'))
    );
    const extras = onlineRadios.filter(
      (r) => !existingNames.has(r.name.toLocaleLowerCase('tr-TR'))
    );
    return [...baseMerged, ...extras];
  }, [
    m3uChannels,
    externalSources,
    externalChannelsMap,
    onlineRadios,
    settings.mergeOnlineRadiosToChannels,
  ]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<CategoryName, number>();
    counts.set('Tümü', allChannels.length);
    counts.set('Favoriler', 0);
    for (const ch of allChannels) {
      if (favoriteIds.has(ch.name)) {
        counts.set('Favoriler', (counts.get('Favoriler') || 0) + 1);
      }
      const cat = ch.smartCategory as CategoryName;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return counts;
  }, [allChannels, favoriteIds]);

  const filteredChannels = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    const hiddenSet = new Set(settings.hiddenCategories);
    return allChannels.filter((ch) => {
      if (
        selectedCategory === 'Tümü' &&
        hiddenSet.has(ch.smartCategory as CategoryName)
      ) {
        return false;
      }
      const matchesCat =
        selectedCategory === 'Tümü'
          ? true
          : selectedCategory === 'Favoriler'
          ? favoriteIds.has(ch.name)
          : ch.smartCategory === selectedCategory;

      const matchesQuery =
        !q || ch.name.toLocaleLowerCase('tr-TR').includes(q);
      return matchesCat && matchesQuery;
    });
  }, [allChannels, selectedCategory, searchQuery, favoriteIds, settings.hiddenCategories]);

  useEffect(() => {
    setVisibleCount(100);
    if (listContainerRef.current) {
      listContainerRef.current.scrollTop = 0;
    }
  }, [selectedCategory, searchQuery]);

  const applyParsedChannels = useCallback(
    (parsed: Channel[], preserveCurrent: boolean, allowAutoPlay: boolean) => {
      setM3uChannels(parsed);
      setCurrentChannel((prev) => {
        if (preserveCurrent && prev) {
          const match = parsed.find((c) => c.name === prev.name);
          if (match) return match;
        }
        if (!allowAutoPlay && !prev) {
          return null;
        }
        if (settings.resumeLastChannel) {
          try {
            const lastName = localStorage.getItem(STORAGE_LAST_CHANNEL_KEY);
            if (lastName) {
              const resumed = parsed.find((c) => c.name === lastName);
              if (resumed) return resumed;
            }
          } catch {
            // ignore
          }
        }
        return (
          parsed.find((c) => c.name.toUpperCase().includes('TRT 1 HD')) ??
          parsed[0] ??
          null
        );
      });
    },
    [settings.resumeLastChannel]
  );

  const loadDefaultPlaylist = useCallback(async () => {
    const res = await fetch('/api/playlist/default', { cache: 'no-store' });
    if (!res.ok) throw new Error('Varsayılan liste yüklenemedi');
    const text = await res.text();
    return parseM3u(text);
  }, []);

  const loadOnlineRadios = useCallback(
    async (scope: 'tr' | 'global', forceRefresh = false) => {
      setIsLoadingRadios(true);
      try {
        const res = await fetch(
          `/api/radios/online?scope=${scope}${forceRefresh ? '&refresh=1' : ''}`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { stations?: OnlineRadioDto[] };
        const mapped = (data.stations || []).map(mapOnlineRadioToChannel);
        if (scope === 'global') {
          setGlobalRadios(mapped);
        } else {
          setOnlineRadios(mapped);
        }
      } catch {
        // Keep existing radio list
      } finally {
        setIsLoadingRadios(false);
      }
    },
    []
  );

  const fetchRemoteM3u = useCallback(
    async (url: string, silentPreserveCurrent = false) => {
      const trimmed = url.trim();
      if (!trimmed) return;
      setIsUpdating(true);
      setStatusMessage('Liste zorunlu olarak güncelleniyor...');
      try {
        const res = await fetch(
          `/api/playlist/import?url=${encodeURIComponent(trimmed)}&_t=${Date.now()}`,
          { cache: 'no-store' }
        );
        const data = await res.json();
        if (!res.ok || !data.content) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const parsed = parseM3u(data.content);
        if (parsed.length === 0) {
          throw new Error('Listede geçerli kanal bulunamadı.');
        }

        try {
          localStorage.setItem(STORAGE_CUSTOM_PLAYLIST_KEY, data.content);
        } catch {
          // Ignore quota error
        }

        const timeLabel = new Date().toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setLastUpdatedAt(timeLabel);
        try {
          localStorage.setItem(STORAGE_LAST_UPDATED_KEY, timeLabel);
        } catch {
          // ignore
        }

        applyParsedChannels(parsed, silentPreserveCurrent, settings.autoPlayOnLaunch);
        setStatusMessage(
          `Liste güncellendi: ${parsed.length} kanal yüklendi.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
        setStatusMessage(`Güncelleme hatası: ${msg}`);
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [applyParsedChannels, settings.autoPlayOnLaunch]
  );

  const persistExternalSources = useCallback((list: ExternalListSource[]) => {
    setExternalSources(list);
    try {
      localStorage.setItem(STORAGE_EXTERNAL_SOURCES_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }, []);

  const persistExternalCache = useCallback((cache: Record<string, Channel[]>) => {
    setExternalChannelsMap(cache);
    try {
      localStorage.setItem(STORAGE_EXTERNAL_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore storage quota errors on huge lists
    }
  }, []);

  const syncExternalSources = useCallback(
    async (overrideSources?: ExternalListSource[], targetSourceId?: string) => {
      const list = overrideSources ?? externalSources;
      const targets = list.filter(
        (s) => s.enabled && (!targetSourceId || s.id === targetSourceId)
      );
      if (targets.length === 0) return;

      setIsSyncingExternal(true);
      try {
        const res = await fetch('/api/playlist/import-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: targets.map((t) => t.url) }),
        });
        const data = (await res.json()) as {
          results?: Array<{
            url: string;
            ok: boolean;
            format?: 'm3u' | 'json';
            content?: string;
            error?: string;
          }>;
        };
        if (!res.ok || !Array.isArray(data.results)) {
          throw new Error('Ek listeler senkronize edilemedi.');
        }

        const timeLabel = new Date().toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
        });

        const nextCache: Record<string, Channel[]> = { ...externalChannelsMap };
        const resultByIdx = data.results;
        const nextSources = list.map((src) => {
          const targetIdx = targets.findIndex((t) => t.id === src.id);
          if (targetIdx === -1) return src;
          const r = resultByIdx[targetIdx];
          if (!r || !r.ok || !r.content) {
            return {
              ...src,
              lastError: r?.error || 'Bağlantı hatası',
            };
          }
          const parsed = parseM3u(r.content).map((ch) => ({
            ...ch,
            id: `${src.id}_${ch.id}`,
            source: (r.format === 'json' ? 'github-json' : 'external') as Channel['source'],
          }));
          nextCache[src.id] = parsed;
          return {
            ...src,
            format: r.format || src.format,
            channelCount: parsed.length,
            lastUpdatedAt: timeLabel,
            lastError: null,
          };
        });

        persistExternalCache(nextCache);
        persistExternalSources(nextSources);
      } catch {
        // Keep cached lists if temporarily offline
      } finally {
        setIsSyncingExternal(false);
      }
    },
    [externalSources, externalChannelsMap, persistExternalCache, persistExternalSources]
  );

  // Initial startup load: M3U + Online Radios + Online EPG + Auto-sync External GitHub Lists
  useEffect(() => {
    let cancelled = false;

    void loadOnlineRadios('tr', false);
    if (settings.epgEnabled) {
      void loadOnlineEpg(settings.epgUrl, false);
    }
    if (settings.autoSyncExternalLists) {
      void syncExternalSources();
    }

    const init = async () => {
      setIsLoading(true);
      const storedUrl = savedUrl.trim();
      const shouldForceUpdate = Boolean(storedUrl) && mandatoryAutoUpdate;

      if (shouldForceUpdate) {
        try {
          await fetchRemoteM3u(storedUrl, false);
          if (!cancelled) setIsLoading(false);
          return;
        } catch {
          // Fall back below
        }
      }

      try {
        const cachedCustom = localStorage.getItem(STORAGE_CUSTOM_PLAYLIST_KEY);
        if (cachedCustom) {
          const parsed = parseUniversalPlaylist(cachedCustom);
          if (parsed.length > 0 && !cancelled) {
            applyParsedChannels(parsed, false, settings.autoPlayOnLaunch);
            setIsLoading(false);
            return;
          }
        }
        const parsedDefault = await loadDefaultPlaylist();
        if (!cancelled) {
          applyParsedChannels(parsedDefault, false, settings.autoPlayOnLaunch);
        }
      } catch {
        if (!cancelled) {
          setStatusMessage('Kanal listesi yüklenemedi.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic background EPG refresh every 10 minutes
  useEffect(() => {
    if (!settings.epgEnabled) {
      setEpgMap({});
      return;
    }
    if (Object.keys(epgMap).length === 0 && !isLoadingEpg) {
      void loadOnlineEpg(settings.epgUrl, false);
    }
    const id = window.setInterval(() => {
      void loadOnlineEpg(settings.epgUrl, false);
    }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.epgEnabled, settings.epgUrl]);

  // Periodic background M3U + External GitHub JSON/M3U auto-update
  useEffect(() => {
    if (settings.autoRefreshMinutes <= 0) {
      return;
    }
    const id = window.setInterval(() => {
      if (savedUrl.trim() && mandatoryAutoUpdate) {
        void fetchRemoteM3u(savedUrl, true).catch(() => {});
      }
      if (settings.autoSyncExternalLists) {
        void syncExternalSources();
      }
    }, settings.autoRefreshMinutes * 60 * 1000);
    return () => window.clearInterval(id);
  }, [
    savedUrl,
    mandatoryAutoUpdate,
    settings.autoRefreshMinutes,
    settings.autoSyncExternalLists,
    fetchRemoteM3u,
    syncExternalSources,
  ]);

  // Sleep timer countdown
  const handleSetSleepTimer = useCallback((minutes: number | null) => {
    if (sleepIntervalRef.current !== null) {
      window.clearInterval(sleepIntervalRef.current);
      sleepIntervalRef.current = null;
    }
    if (!minutes || minutes <= 0) {
      setSleepMinutes(null);
      return;
    }
    setSleepMinutes(minutes);
    sleepIntervalRef.current = window.setInterval(() => {
      setSleepMinutes((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (sleepIntervalRef.current !== null) {
            window.clearInterval(sleepIntervalRef.current);
            sleepIntervalRef.current = null;
          }
          setPauseSignal((s) => s + 1);
          return null;
        }
        return prev - 1;
      });
    }, 60_000);
  }, []);

  useEffect(() => {
    return () => {
      if (sleepIntervalRef.current !== null) {
        window.clearInterval(sleepIntervalRef.current);
      }
    };
  }, []);

  const toggleFavorite = useCallback((channel: Channel) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(channel.name)) next.delete(channel.name);
      else next.add(channel.name);
      try {
        localStorage.setItem(STORAGE_FAVS_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const clearFavorites = useCallback(() => {
    setFavoriteIds(new Set());
    try {
      localStorage.removeItem(STORAGE_FAVS_KEY);
    } catch {
      // ignore
    }
    setStatusMessage('Favoriler temizlendi.');
  }, []);

  const activePlaybackPool = useMemo(() => {
    if (activeTab === 'radio') {
      return onlineRadios.length > 0 ? onlineRadios : allChannels;
    }
    return filteredChannels.length > 0 ? filteredChannels : allChannels;
  }, [activeTab, onlineRadios, filteredChannels, allChannels]);

  const handleSelectChannel = useCallback(
    (ch: Channel) => {
      if (multiScreenLayout === 1) {
        setCurrentChannel(ch);
      } else {
        setMultiSlots((prev) => {
          const next = [...prev];
          next[activeSlotIndex] = ch;
          return next;
        });
        setCurrentChannel(ch);
      }
    },
    [multiScreenLayout, activeSlotIndex]
  );

  const handleToggleMultiScreen = useCallback(() => {
    setMultiScreenLayout((prev) => {
      if (prev === 1) {
        // Pre-populate empty tiles with current channel + next available channels
        const pool = filteredChannels.length > 0 ? filteredChannels : allChannels;
        const first = currentChannel || pool[0] || null;
        const extras = pool.filter((c) => !c.isRadio && c.id !== first?.id);
        setMultiSlots([
          first,
          extras[0] ?? null,
          extras[1] ?? null,
          extras[2] ?? null,
        ]);
        setActiveSlotIndex(0);
        setAudioSlotIndex(0);
        return 2;
      }
      if (prev === 2) return 4;
      return 1;
    });
  }, [filteredChannels, allChannels, currentChannel]);

  const playNextChannel = useCallback(() => {
    if (activePlaybackPool.length === 0) return;
    const idx = activePlaybackPool.findIndex((c) => c.id === currentChannel?.id);
    const next = activePlaybackPool[(idx + 1) % activePlaybackPool.length];
    setCurrentChannel(next);
  }, [activePlaybackPool, currentChannel]);

  const playPreviousChannel = useCallback(() => {
    if (activePlaybackPool.length === 0) return;
    const idx = activePlaybackPool.findIndex((c) => c.id === currentChannel?.id);
    const prev =
      idx <= 0
        ? activePlaybackPool[activePlaybackPool.length - 1]
        : activePlaybackPool[idx - 1];
    setCurrentChannel(prev);
  }, [activePlaybackPool, currentChannel]);

  const handleToggleFullscreen = useCallback(async (enable: boolean) => {
    setIsFullscreen(enable);
    try {
      if (enable && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else if (!enable && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Fallback CSS fixed inset-0 handles fullscreen inside iframes / WebViews
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen((prev) => (prev ? false : prev));
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const handleToggleAspect = useCallback(() => {
    setAspectMode((prev) =>
      prev === 'fit' ? 'fill' : prev === 'fill' ? 'zoom' : 'fit'
    );
  }, []);

  const handleSaveAndUpdate = useCallback(
    (url: string, mandatory: boolean) => {
      setSavedUrl(url);
      setMandatoryAutoUpdate(mandatory);
      try {
        localStorage.setItem(STORAGE_URL_KEY, url);
        localStorage.setItem(STORAGE_MANDATORY_KEY, String(mandatory));
      } catch {
        // ignore
      }
      void fetchRemoteM3u(url, false).catch(() => {});
    },
    [fetchRemoteM3u]
  );

  const handleImportLocalM3u = useCallback(
    (content: string, filename: string) => {
      const parsed = parseUniversalPlaylist(content);
      if (parsed.length === 0) {
        setStatusMessage(`${filename} içinde geçerli kanal bulunamadı.`);
        return;
      }
      try {
        localStorage.setItem(STORAGE_CUSTOM_PLAYLIST_KEY, content);
      } catch {
        // ignore
      }
      const timeLabel = new Date().toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      setLastUpdatedAt(timeLabel);
      applyParsedChannels(parsed, false, true);
      setStatusMessage(`${filename} yüklendi: ${parsed.length} kanal.`);
    },
    [applyParsedChannels]
  );

  const handleAddBulkExternalSources = useCallback(
    async (rawUrlsText: string, customName?: string) => {
      const rawLines = rawUrlsText
        .split(/[\r\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => /^https?:\/\//i.test(s));

      if (rawLines.length === 0) {
        throw new Error('Geçerli http:// veya https:// adres bulunamadı.');
      }

      const existingUrls = new Set(externalSources.map((s) => s.url));
      const added: ExternalListSource[] = [];
      for (let i = 0; i < rawLines.length; i++) {
        const normalized = normalizeGithubRawUrl(rawLines[i]);
        if (existingUrls.has(normalized)) continue;
        existingUrls.add(normalized);
        const filename =
          normalized.split('/').pop()?.split('?')[0] || `Ek Liste ${i + 1}`;
        const label =
          customName && rawLines.length === 1
            ? customName
            : customName
            ? `${customName} #${i + 1}`
            : filename;
        added.push({
          id: `ext_${Date.now()}_${i}`,
          name: label,
          url: normalized,
          format: normalized.toLowerCase().endsWith('.json') ? 'json' : 'auto',
          enabled: true,
          autoSync: true,
        });
      }

      if (added.length === 0) {
        await syncExternalSources(externalSources);
        setStatusMessage('Girilen adresler zaten ekli, tüm ek listeler güncellendi.');
        return;
      }

      const nextList = [...externalSources, ...added];
      persistExternalSources(nextList);
      await syncExternalSources(nextList);
      setStatusMessage(
        `${added.length} yeni ek liste eklendi ve otomatik senkronize edildi.`
      );
    },
    [externalSources, persistExternalSources, syncExternalSources]
  );

  const handleToggleExternalSource = useCallback(
    (sourceId: string) => {
      const next = externalSources.map((s) =>
        s.id === sourceId ? { ...s, enabled: !s.enabled } : s
      );
      persistExternalSources(next);
      const toggled = next.find((s) => s.id === sourceId);
      if (toggled?.enabled && !externalChannelsMap[sourceId]) {
        void syncExternalSources(next, sourceId);
      }
    },
    [externalSources, externalChannelsMap, persistExternalSources, syncExternalSources]
  );

  const handleRemoveExternalSource = useCallback(
    (sourceId: string) => {
      const next = externalSources.filter((s) => s.id !== sourceId);
      persistExternalSources(next);
      const nextCache = { ...externalChannelsMap };
      delete nextCache[sourceId];
      persistExternalCache(nextCache);
      setStatusMessage('Ek liste kaldırıldı.');
    },
    [externalSources, externalChannelsMap, persistExternalSources, persistExternalCache]
  );

  const handleResetExternalPresets = useCallback(() => {
    const customOnly = externalSources.filter((s) => !s.isBuiltinPreset);
    const next = [...DEFAULT_EXTERNAL_SOURCES, ...customOnly];
    persistExternalSources(next);
    void syncExternalSources(next);
    setStatusMessage('Varsayılan GitHub Spor ve Türkiye ek listeleri güncellendi.');
  }, [externalSources, persistExternalSources, syncExternalSources]);

  const handleImportLocalExtraFile = useCallback(
    (content: string, filename: string) => {
      const parsed = parseUniversalPlaylist(content, filename);
      if (parsed.length === 0) {
        setStatusMessage(`${filename} içinde geçerli kanal bulunamadı.`);
        return;
      }
      const sourceId = `local_${Date.now()}`;
      const isJson = filename.toLowerCase().endsWith('.json');
      const tagged = parsed.map((ch) => ({
        ...ch,
        id: `${sourceId}_${ch.id}`,
        source: (isJson ? 'github-json' : 'external') as Channel['source'],
      }));
      const newSrc: ExternalListSource = {
        id: sourceId,
        name: filename,
        url: `yerel://${filename}`,
        format: isJson ? 'json' : 'm3u',
        enabled: true,
        autoSync: false,
        channelCount: tagged.length,
        lastUpdatedAt: new Date().toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      persistExternalCache({ ...externalChannelsMap, [sourceId]: tagged });
      persistExternalSources([...externalSources, newSrc]);
      setStatusMessage(`${filename} ek liste olarak eklendi: ${tagged.length} kanal.`);
    },
    [externalSources, externalChannelsMap, persistExternalCache, persistExternalSources]
  );

  const handleImportXtream = useCallback(
    async (server: string, username: string, password: string) => {
      setIsUpdating(true);
      try {
        const res = await fetch('/api/xtream/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ server, username, password }),
        });
        const data = (await res.json()) as {
          content?: string;
          count?: number;
          error?: string;
        };
        if (!res.ok || !data.content) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const parsed = parseM3u(data.content).map((c) => ({
          ...c,
          source: 'xtream' as const,
        }));
        if (parsed.length === 0) {
          throw new Error('Xtream hesabında kanal bulunamadı.');
        }
        try {
          localStorage.setItem(STORAGE_CUSTOM_PLAYLIST_KEY, data.content);
        } catch {
          // ignore
        }
        const timeLabel = new Date().toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        setLastUpdatedAt(timeLabel);
        applyParsedChannels(parsed, false, true);
        setStatusMessage(`Xtream hesabı bağlandı: ${parsed.length} kanal.`);
      } finally {
        setIsUpdating(false);
      }
    },
    [applyParsedChannels]
  );

  const handleResetDefault = useCallback(async () => {
    setSavedUrl('');
    try {
      localStorage.removeItem(STORAGE_URL_KEY);
      localStorage.removeItem(STORAGE_CUSTOM_PLAYLIST_KEY);
      localStorage.removeItem(STORAGE_LAST_UPDATED_KEY);
    } catch {
      // ignore
    }
    setLastUpdatedAt(null);
    setIsLoading(true);
    try {
      const parsed = await loadDefaultPlaylist();
      applyParsedChannels(parsed, false, true);
      setStatusMessage('Varsayılan Eymen TV listesine dönüldü.');
    } catch {
      setStatusMessage('Varsayılan liste yüklenemedi.');
    } finally {
      setIsLoading(false);
    }
  }, [loadDefaultPlaylist, applyParsedChannels]);

  const activeEpgMap = settings.epgEnabled ? epgMap : {};
  const currentEpg = currentChannel
    ? lookupEpgForChannel(activeEpgMap, currentChannel.name)
    : null;
  const currentEpgProgress = currentEpg?.now
    ? computeEpgProgress(currentEpg.now.startMs, currentEpg.now.stopMs)
    : 0;

  return (
    <div className="h-dvh w-full flex flex-col bg-[var(--bg)] text-[var(--ink)] overflow-hidden">
      {/* Compact Single-Row Header */}
      <header className="shrink-0 flex items-center justify-between gap-3 px-3.5 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] flex items-center justify-center">
            <Tv className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="text-[15px] sm:text-base font-extrabold tracking-tight text-[var(--ink)] truncate">
                EYMEN TV &amp; RADYO
              </h1>
              <span className="text-[var(--accent)] font-extrabold text-base leading-none">
                .
              </span>
            </div>
            <p className="text-[11px] text-[var(--muted)] truncate">
              <span className="font-mono-nums">{allChannels.length}</span> Kanal ·{' '}
              <span className="font-mono-nums">{onlineRadios.length}</span> Radyo · Hazırlayan: Mehmet Cengiz Akdağ
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {sleepMinutes !== null && (
            <span className="font-mono-nums px-2 py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--accent)] text-[11px] font-bold">
              {sleepMinutes}dk
            </span>
          )}

          {savedUrl.trim() && (
            <button
              type="button"
              onClick={() => void fetchRemoteM3u(savedUrl, true).catch(() => {})}
              disabled={isUpdating}
              title="M3U Listesini Güncelle"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--accent)] text-xs font-semibold hover:border-[var(--accent)] disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>Güncelle</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleToggleMultiScreen}
            title="Çoklu Ekran Modu (1 / 2 / 4 Ekran)"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
              multiScreenLayout > 1
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] hover:border-[var(--accent)]'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden md:inline font-mono-nums">
              {multiScreenLayout === 1
                ? 'Çoklu Ekran'
                : `${multiScreenLayout}'li Ekran`}
            </span>
          </button>

          {currentChannel && !currentChannel.isRadio && settings.epgEnabled && (
            <button
              type="button"
              onClick={() => setShowEpgDialog(true)}
              aria-label="Yayın Akışı (EPG)"
              title="Yayın Akışı (EPG)"
              className="p-2 rounded-lg text-[var(--accent)] hover:bg-white/10"
            >
              <CalendarClock className="w-5 h-5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowSleepDialog(true)}
            aria-label="Uyku Zamanlayıcı"
            title="Uyku Zamanlayıcı"
            className="p-2 rounded-lg text-[var(--accent)] hover:bg-white/10"
          >
            <Moon className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowUrlDialog(true)}
            aria-label="Kanallar ve Listeler (M3U / Dosya / Xtream)"
            title="Kanallar ve Listeler"
            className="p-2 rounded-lg text-[var(--accent)] hover:bg-white/10"
          >
            <CloudDownload className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            aria-label="Ayarlar"
            title="Ayarlar"
            className={`p-2 rounded-lg hover:bg-white/10 ${
              activeTab === 'settings'
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--accent)]'
            }`}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Beleş TiVi 3-Zone Workspace on Desktop/TV (Left Category Sidebar + Center Stage + Right Channel/Tab Panel) */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Zone 1: Left TV Category Sidebar (Desktop & TV Box) */}
        <aside
          aria-label="Kategoriler"
          className="hidden lg:flex lg:w-[215px] xl:w-[230px] shrink-0 flex-col bg-[var(--surface-2)] border-r border-[var(--border)]"
        >
          <div className="px-3.5 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Kategoriler
            </span>
            <span className="text-[10px] font-bold text-[var(--live)] uppercase tracking-wider">
              CANLI YAYIN
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {visibleCategories.map((category) => {
              const selected = category === selectedCategory;
              const count = categoryCounts.get(category) ?? 0;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(category);
                    setActiveTab('channels');
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    selected
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                      : 'text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    {category === 'Favoriler' && (
                      <Heart
                        className={`w-3.5 h-3.5 shrink-0 ${
                          selected ? 'fill-[var(--accent-ink)]' : 'text-[var(--live)]'
                        }`}
                      />
                    )}
                    <span className="truncate">{category}</span>
                  </span>
                  <span
                    className={`font-mono-nums text-[11px] shrink-0 ${
                      selected ? 'text-[var(--accent-ink)]/80' : 'text-[var(--muted)]/70'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="p-2.5 border-t border-[var(--border)] space-y-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('vod')}
              className={`w-full py-2 px-3 rounded-xl border text-xs font-semibold transition-colors text-left flex items-center justify-between ${
                activeTab === 'vod'
                  ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-ink)] font-bold'
                  : 'bg-[var(--surface)] border-[var(--border)] text-[var(--ink)] hover:border-[var(--accent)]'
              }`}
            >
              <span className="flex items-center gap-1.5 truncate">
                <Film className="w-3.5 h-3.5 shrink-0" />
                <span>Film &amp; Dizi</span>
              </span>
              <span className="font-mono-nums text-[11px] opacity-80">
                {vodItems.length + xtreamSeries.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowUrlDialog(true)}
              className="w-full py-2 px-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)] transition-colors text-left flex items-center justify-between"
            >
              <span>Liste / Xtream Ekle</span>
              <span className="text-[var(--accent)]">+</span>
            </button>
          </div>
        </aside>

        {/* Zone 2: Center Video / Multi-Screen Stage + Desktop EPG Now/Next Strip */}
        <section className="shrink-0 lg:flex-1 lg:flex lg:flex-col lg:min-w-0 bg-black lg:border-r lg:border-[var(--border)]">
          <div className="lg:flex-1 lg:flex lg:items-center lg:justify-center lg:min-h-0 bg-black">
            {multiScreenLayout === 2 || multiScreenLayout === 4 ? (
              <MultiScreenGrid
                layout={multiScreenLayout}
                slots={multiSlots}
                activeSlotIndex={activeSlotIndex}
                audioSlotIndex={audioSlotIndex}
                aspectMode={aspectMode}
                isFullscreen={isFullscreen}
                onSelectSlot={(idx) => setActiveSlotIndex(idx)}
                onSetAudioSlot={(idx) => setAudioSlotIndex(idx)}
                onFocusSingle={(idx) => {
                  const chosen = multiSlots[idx];
                  if (chosen) setCurrentChannel(chosen);
                  setMultiScreenLayout(1);
                }}
                onCycleLayout={() =>
                  setMultiScreenLayout((prev) => (prev === 2 ? 4 : 2))
                }
                onExitMultiScreen={() => setMultiScreenLayout(1)}
                onToggleFullscreen={handleToggleFullscreen}
              />
            ) : (
              <VideoPlayerSurface
                currentChannel={currentChannel}
                channels={filteredChannels}
                visibleCategories={visibleCategories}
                selectedCategory={selectedCategory}
                searchQuery={searchQuery}
                favoriteIds={favoriteIds}
                aspectMode={aspectMode}
                isFullscreen={isFullscreen}
                pauseSignal={pauseSignal}
                hudHideSeconds={settings.hudHideSeconds}
                controlsSize={settings.playerControlsSize}
                highContrastControls={settings.playerHighContrastControls}
                seekStepSeconds={settings.playerSeekStepSeconds}
                radioEffectMode={settings.radioEffectMode}
                radioEffectIntensity={settings.radioEffectIntensity}
                radioShowLogo={settings.radioShowLogoInStage}
                radioBackgroundImage={settings.radioBackgroundImage}
                epgMap={activeEpgMap}
                vodResumeTime={
                  currentChannel && settings.resumeLastChannel
                    ? vodProgressMap[currentChannel.id]?.currentTime ?? 0
                    : 0
                }
                onVodProgress={(channelId, currentTime, duration) => {
                  setVodProgressMap((prev) => {
                    const next = {
                      ...prev,
                      [channelId]: { currentTime, duration, updatedAt: Date.now() },
                    };
                    try {
                      localStorage.setItem(STORAGE_VOD_PROGRESS_KEY, JSON.stringify(next));
                    } catch {
                      // ignore
                    }
                    return next;
                  });
                }}
                onSelectChannel={handleSelectChannel}
                onSelectCategory={setSelectedCategory}
                onSearchChange={setSearchQuery}
                onToggleFavorite={toggleFavorite}
                onToggleFullscreen={handleToggleFullscreen}
                onToggleAspect={handleToggleAspect}
                onEnableMultiScreen={handleToggleMultiScreen}
                onOpenEpg={
                  settings.epgEnabled ? () => setShowEpgDialog(true) : undefined
                }
                onPrev={playPreviousChannel}
                onNext={playNextChannel}
              />
            )}
          </div>

          {/* Desktop/TV Below-Stage Info & EPG Bar */}
          {currentChannel && multiScreenLayout === 1 && (
            <div className="hidden lg:flex shrink-0 items-center justify-between gap-4 px-4 py-2.5 bg-[var(--surface-2)] border-t border-[var(--border)]">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-extrabold text-[var(--ink)] truncate">
                    {currentChannel.name}
                  </span>
                  <span className="text-xs text-[var(--muted)] truncate">
                    · {currentChannel.smartCategory}
                  </span>
                </div>
                {currentEpg?.now ? (
                  <div className="mt-1 flex items-center gap-3">
                    <span className="text-xs font-semibold text-[var(--accent)] truncate">
                      Şimdi: {currentEpg.now.title}
                    </span>
                    <span className="font-mono-nums text-[11px] text-[var(--muted)] shrink-0">
                      {formatEpgTime(currentEpg.now.startMs)} –{' '}
                      {formatEpgTime(currentEpg.now.stopMs)}
                    </span>
                    <div className="w-24 h-1.5 rounded bg-[var(--bg)] overflow-hidden shrink-0">
                      <div
                        className="h-full bg-[var(--accent)]"
                        style={{ width: `${currentEpgProgress}%` }}
                      />
                    </div>
                    {currentEpg.next && (
                      <span className="text-xs text-[var(--muted)] truncate">
                        Sonraki: {currentEpg.next.title}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-0.5 text-xs text-[var(--muted)]">
                    Hazırlayan: Mehmet Cengiz Akdağ · Kumanda ile Ok tuşları / Enter
                  </div>
                )}
              </div>

              {!currentChannel.isRadio && settings.epgEnabled && (
                <button
                  type="button"
                  onClick={() => setShowEpgDialog(true)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)]"
                >
                  <CalendarClock className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>Yayın Akışı</span>
                </button>
              )}
            </div>
          )}
        </section>

        {/* Zone 3: Right / Bottom Panel (Kanallar | Online Radyo | Ayarlar) */}
        <section className="flex-1 min-h-0 lg:flex-none lg:w-[370px] xl:w-[410px] flex flex-col bg-[var(--bg)]">
          {/* Primary 4-Tab Switcher */}
          <nav
            aria-label="Ana Sekmeler"
            className="shrink-0 grid grid-cols-4 gap-1 p-2 bg-[var(--surface-2)] border-b border-[var(--border)]"
          >
            <button
              type="button"
              onClick={() => setActiveTab('channels')}
              className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-xl text-[11px] font-bold transition-colors focus:outline-none ${
                activeTab === 'channels'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                  : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Tv className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Kanallar</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('vod')}
              className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-xl text-[11px] font-bold transition-colors focus:outline-none ${
                activeTab === 'vod'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                  : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Film className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Film &amp; Dizi</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('radio')}
              className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-xl text-[11px] font-bold transition-colors focus:outline-none ${
                activeTab === 'radio'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                  : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Radio className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Radyo</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-xl text-[11px] font-bold transition-colors focus:outline-none ${
                activeTab === 'settings'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                  : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Settings className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Ayarlar</span>
            </button>
          </nav>

          {/* Status Banner */}
          {statusMessage && (
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--surface-elevated)] border-b border-[var(--border)] text-xs">
              <span className="text-[var(--accent)] font-medium truncate">
                {statusMessage}
              </span>
              <button
                type="button"
                onClick={() => setStatusMessage(null)}
                className="text-[var(--ink)] font-bold shrink-0 hover:underline"
              >
                Kapat
              </button>
            </div>
          )}

          {/* TAB 1: Kanallar */}
          {activeTab === 'channels' && (
            <>
              <div className="shrink-0 px-3 pt-2.5 pb-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-[var(--accent)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      multiScreenLayout > 1
                        ? `Ekran ${activeSlotIndex + 1} için kanal ara...`
                        : 'TV kanalı, maç veya radyo ara...'
                    }
                    className="w-full rounded-xl bg-[var(--surface)] border border-[var(--border)] pl-10 pr-9 py-2.5 text-[13px] text-[var(--ink)] placeholder-[var(--muted)]/60 focus:outline-none focus:border-[var(--accent)]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Temizle"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--muted)] hover:text-[var(--ink)]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Mobile / Tablet Horizontal Categories (Hidden on Desktop where Left Sidebar handles categories) */}
              <div className="lg:hidden shrink-0 flex items-center gap-1.5 px-3 pb-2 overflow-x-auto">
                {visibleCategories.map((category) => {
                  const selected = category === selectedCategory;
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setSelectedCategory(category)}
                      className={`shrink-0 px-3 py-1.5 rounded-lg text-xs transition-colors focus:outline-none ${
                        selected
                          ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                          : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]'
                      }`}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>

              {isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="w-9 h-9 rounded-full border-3 border-[var(--accent)]/25 border-t-[var(--accent)] animate-spin" />
                </div>
              ) : (
                <div
                  ref={listContainerRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    if (
                      el.scrollHeight - el.scrollTop - el.clientHeight < 350 &&
                      visibleCount < filteredChannels.length
                    ) {
                      setVisibleCount((prev) =>
                        Math.min(prev + 100, filteredChannels.length)
                      );
                    }
                  }}
                  className="flex-1 min-h-0 overflow-y-auto px-3 py-1 space-y-2 pb-4"
                >
                  {filteredChannels.slice(0, visibleCount).map((channel) => (
                    <ChannelRowItem
                      key={channel.id}
                      channel={channel}
                      epgNow={
                        channel.isRadio
                          ? null
                          : lookupEpgForChannel(activeEpgMap, channel.name)?.now
                              ?.title ?? null
                      }
                      isPlaying={
                        multiScreenLayout > 1
                          ? multiSlots
                              .slice(0, multiScreenLayout)
                              .some((s) => s?.id === channel.id)
                          : currentChannel?.id === channel.id
                      }
                      isFavorite={favoriteIds.has(channel.name)}
                      onSelect={() => handleSelectChannel(channel)}
                      onToggleFavorite={() => toggleFavorite(channel)}
                    />
                  ))}

                  {filteredChannels.length === 0 && (
                    <div className="py-12 text-center text-sm text-[var(--muted)]">
                      Aramanızla eşleşen kanal bulunamadı.
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* TAB 2: Film & Dizi (VOD with Auto-Categories) */}
          {activeTab === 'vod' && (
            <VodSectionTab
              vodItems={vodItems}
              xtreamSeries={xtreamSeries}
              xtreamAuth={xtreamVodAuth}
              progressMap={vodProgressMap}
              favoriteIds={favoriteIds}
              currentChannel={currentChannel}
              cinemaLiveCount={
                m3uChannels.filter((c) => c.smartCategory === 'Sinema & Dizi').length
              }
              onPlayVodItem={(item) => handleSelectChannel(vodItemToChannel(item))}
              onPlayEpisodeChannel={(epCh) => handleSelectChannel(epCh)}
              onToggleFavorite={toggleFavorite}
              onOpenImportModal={() => setShowVodModal(true)}
              onExtractCinemaFromLive={() => {
                const cinemaItems = m3uChannels.filter(
                  (c) => c.smartCategory === 'Sinema & Dizi'
                );
                const lines = ['#EXTM3U'];
                for (const c of cinemaItems) {
                  const logoAttr = c.logoUrl ? ` tvg-logo="${c.logoUrl}"` : '';
                  lines.push(
                    `#EXTINF:-1 tvg-name="${c.name.replace(/"/g, '')}"${logoAttr} group-title="Sinema & Dizi",${c.name}`
                  );
                  lines.push(c.streamUrl);
                }
                const content = lines.join('\n');
                const parsed = parseVodM3u(content);
                setVodItems(parsed);
                try {
                  localStorage.setItem(STORAGE_VOD_PLAYLIST_KEY, content);
                } catch {
                  // ignore
                }
                setStatusMessage(
                  `${parsed.length} sinema/dizi içeriği otomatik kategorilendirildi.`
                );
              }}
            />
          )}

          {/* TAB 3: Online Radyo */}
          {activeTab === 'radio' && (
            <OnlineRadioTab
              radios={onlineRadios}
              globalRadios={globalRadios}
              isLoading={isLoadingRadios}
              currentChannel={currentChannel}
              favoriteIds={favoriteIds}
              onSelectChannel={handleSelectChannel}
              onToggleFavorite={toggleFavorite}
              onRefresh={(scope) => void loadOnlineRadios(scope, true)}
            />
          )}

          {/* TAB 4: Ayarlar */}
          {activeTab === 'settings' && (
            <SettingsTab
              settings={settings}
              savedUrl={savedUrl}
              mandatoryAutoUpdate={mandatoryAutoUpdate}
              lastUpdatedAt={lastUpdatedAt}
              externalSources={externalSources}
              isSyncingExternal={isSyncingExternal}
              sleepMinutes={sleepMinutes}
              isUpdating={isUpdating}
              isLoadingEpg={isLoadingEpg}
              epgChannelCount={epgChannelCount}
              favoriteCount={favoriteIds.size}
              totalChannelsCount={allChannels.length}
              onlineRadiosCount={onlineRadios.length}
              onUpdateSettings={updateSettings}
              onSaveAndUpdateUrl={handleSaveAndUpdate}
              onAddBulkExternalSources={handleAddBulkExternalSources}
              onToggleExternalSource={handleToggleExternalSource}
              onRemoveExternalSource={handleRemoveExternalSource}
              onSyncExternalSources={(id) => syncExternalSources(undefined, id)}
              onResetExternalPresets={handleResetExternalPresets}
              onImportLocalExtraFile={handleImportLocalExtraFile}
              onOpenSourcesModal={() => setShowUrlDialog(true)}
              onResetDefaultPlaylist={handleResetDefault}
              onRefreshEpg={(url) => void loadOnlineEpg(url, true)}
              onSetSleepMinutes={handleSetSleepTimer}
              onClearFavorites={clearFavorites}
            />
          )}
        </section>
      </main>

      {/* Modals */}
      <PlaylistUpdateModal
        isOpen={showUrlDialog}
        savedUrl={savedUrl}
        mandatoryAutoUpdate={mandatoryAutoUpdate}
        lastUpdatedAt={lastUpdatedAt}
        onClose={() => setShowUrlDialog(false)}
        onSaveAndUpdate={handleSaveAndUpdate}
        onAddBulkSources={handleAddBulkExternalSources}
        onImportLocalM3u={handleImportLocalM3u}
        onImportXtream={handleImportXtream}
        onResetDefault={handleResetDefault}
      />

      <VodImportModal
        isOpen={showVodModal}
        savedVodUrl={savedVodUrl}
        hasVodItems={vodItems.length > 0 || xtreamSeries.length > 0}
        onClose={() => setShowVodModal(false)}
        onImportVodUrl={async (url) => {
          const res = await fetch(
            `/api/playlist/import?url=${encodeURIComponent(url)}&_t=${Date.now()}`,
            { cache: 'no-store' }
          );
          const data = (await res.json()) as { content?: string; error?: string };
          if (!res.ok || !data.content) {
            throw new Error(data.error || `HTTP ${res.status}`);
          }
          const parsed = parseVodM3u(data.content);
          if (parsed.length === 0) {
            throw new Error('Bu listede film veya dizi bulunamadı.');
          }
          setVodItems(parsed);
          setSavedVodUrl(url);
          try {
            localStorage.setItem(STORAGE_VOD_PLAYLIST_KEY, data.content);
            localStorage.setItem(STORAGE_VOD_URL_KEY, url);
          } catch {
            // ignore
          }
          const catCount = new Set(parsed.map((p) => p.autoCategory)).size;
          setStatusMessage(
            `${parsed.length} film/dizi eklendi ve ${catCount} kategori otomatik oluşturuldu.`
          );
        }}
        onImportVodFile={(content, filename) => {
          const parsed = parseVodM3u(content);
          if (parsed.length === 0) {
            setStatusMessage(`${filename} içinde geçerli film/dizi bulunamadı.`);
            return;
          }
          setVodItems(parsed);
          try {
            localStorage.setItem(STORAGE_VOD_PLAYLIST_KEY, content);
          } catch {
            // ignore
          }
          const catCount = new Set(parsed.map((p) => p.autoCategory)).size;
          setStatusMessage(
            `${filename}: ${parsed.length} film/dizi ve ${catCount} otomatik kategori oluşturuldu.`
          );
        }}
        onImportXtreamVod={async (server, username, password) => {
          const res = await fetch('/api/xtream/vod', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ server, username, password }),
          });
          const data = (await res.json()) as {
            content?: string;
            series?: XtreamSeriesEntry[];
            xtreamAuth?: XtreamVodAuth;
            error?: string;
          };
          if (!res.ok || !data.content || !data.xtreamAuth) {
            throw new Error(data.error || `HTTP ${res.status}`);
          }
          const parsedMovies = parseVodM3u(data.content);
          const seriesList = data.series || [];
          setVodItems(parsedMovies);
          setXtreamSeries(seriesList);
          setXtreamVodAuth(data.xtreamAuth);
          try {
            localStorage.setItem(STORAGE_VOD_PLAYLIST_KEY, data.content);
            localStorage.setItem(STORAGE_VOD_SERIES_KEY, JSON.stringify(seriesList));
            localStorage.setItem(STORAGE_VOD_AUTH_KEY, JSON.stringify(data.xtreamAuth));
          } catch {
            // ignore
          }
          setStatusMessage(
            `Xtream VOD: ${parsedMovies.length} film ve ${seriesList.length} dizi otomatik kategorilendirildi.`
          );
          return {
            content: data.content,
            series: seriesList,
            xtreamAuth: data.xtreamAuth,
          };
        }}
        onClearVodList={() => {
          setVodItems([]);
          setXtreamSeries([]);
          setXtreamVodAuth(null);
          try {
            localStorage.removeItem(STORAGE_VOD_PLAYLIST_KEY);
            localStorage.removeItem(STORAGE_VOD_URL_KEY);
            localStorage.removeItem(STORAGE_VOD_SERIES_KEY);
            localStorage.removeItem(STORAGE_VOD_AUTH_KEY);
          } catch {
            // ignore
          }
          setStatusMessage('Film & Dizi listesi temizlendi.');
        }}
      />

      <SleepTimerModal
        isOpen={showSleepDialog}
        onClose={() => setShowSleepDialog(false)}
        onSelectMinutes={handleSetSleepTimer}
      />

      <EpgScheduleModal
        isOpen={showEpgDialog}
        channel={currentChannel}
        epgUrl={settings.epgUrl}
        onClose={() => setShowEpgDialog(false)}
      />
    </div>
  );
}
