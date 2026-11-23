import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  CalendarClock,
  Check,
  CloudDownload,
  Film,
  Heart,
  History,
  LayoutGrid,
  LogOut,
  PanelLeftOpen,
  PanelRightOpen,
  Radio,
  Search,
  Settings,
  Tv,
  WifiOff,
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
  type EpgReminderItem,
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
  normalizeInputUrl,
  parseM3u,
  parseUniversalPlaylist,
} from './utils/m3uParser';
import { parseVodM3u, vodItemToChannel } from './utils/vodParser';
import { isAdultContent } from './utils/contentFilter';
import { computeEpgProgress, formatEpgTime, lookupEpgForChannel } from './utils/epg';
import {
  clearChannelPerfMap,
  loadChannelPerfMap,
  recordChannelPerfEvent,
  saveChannelPerfMap,
  sortChannelsByPerformance,
  type ChannelPerfEvent,
  type ChannelPerfStats,
} from './utils/channelPerformance';
import { AppLogoBadge, CategoryIcon } from './components/BrandMark';
import { VideoPlayerSurface } from './components/VideoPlayerSurface';
import { MultiScreenGrid } from './components/MultiScreenGrid';
import { ChannelRowItem } from './components/ChannelRowItem';
import { OnlineRadioTab } from './components/OnlineRadioTab';
import { VodSectionTab } from './components/VodSectionTab';
import { SettingsTab } from './components/SettingsTab';
import { ExitConfirmModal } from './components/ExitConfirmModal';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  applyCachedLogosToChannels,
  isDeadLogoUrl,
  resolveAndAttachChannelLogos,
} from './utils/logoResolver';
import {
  getRemoteDirection,
  installRemoteBridge,
  isAnyRemoteNavigationKey,
  isRemoteBackKey,
  isRemoteMenuKey,
  isRemoteSelectKey,
  isTextInputElement,
  isTvEnvironment,
  triggerElementActivation,
} from './utils/remoteKeys';

const PlaylistUpdateModal = lazy(() =>
  import('./components/PlaylistUpdateModal').then((m) => ({
    default: m.PlaylistUpdateModal,
  }))
);
const VodImportModal = lazy(() =>
  import('./components/VodImportModal').then((m) => ({
    default: m.VodImportModal,
  }))
);
const SleepTimerModal = lazy(() =>
  import('./components/SleepTimerModal').then((m) => ({
    default: m.SleepTimerModal,
  }))
);
const EpgScheduleModal = lazy(() =>
  import('./components/EpgScheduleModal').then((m) => ({
    default: m.EpgScheduleModal,
  }))
);

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
const STORAGE_AI_LAST_RUN_KEY = 'eymen_ai_last_discover_ts';
const STORAGE_VOD_PLAYLIST_KEY = 'eymen_vod_playlist';
const STORAGE_VOD_URL_KEY = 'eymen_vod_url';
const STORAGE_VOD_SERIES_KEY = 'eymen_vod_xtream_series';
const STORAGE_VOD_AUTH_KEY = 'eymen_vod_xtream_auth';
const STORAGE_VOD_PROGRESS_KEY = 'eymen_vod_progress';
const STORAGE_RECENT_CHANNELS_KEY = 'eymen_recent_channels_v1';
const STORAGE_EPG_REMINDERS_KEY = 'eymen_epg_reminders_v1';

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
      if (saved === 'Favoriler' && readInitialFavorites().size === 0) {
        return 'Tümü';
      }
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
  const [kurdishRadios, setKurdishRadios] = useState<Channel[]>([]);
  const [globalRadios, setGlobalRadios] = useState<Channel[]>([]);
  const [isLoadingRadios, setIsLoadingRadios] = useState(false);

  const [epgMap, setEpgMap] = useState<Record<string, EpgNowNext>>({});
  const [epgChannelCount, setEpgChannelCount] = useState(0);
  const [isLoadingEpg, setIsLoadingEpg] = useState(false);
  const [showEpgDialog, setShowEpgDialog] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isAppClosed, setIsAppClosed] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [headerAutoHidden, setHeaderAutoHidden] = useState(false);
  const [isLeftVodOpen, setIsLeftVodOpen] = useState(true);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(true);
  const [perfMap, setPerfMap] = useState<Record<string, ChannelPerfStats>>(
    loadChannelPerfMap
  );

  const [selectedCategory, setSelectedCategory] = useState<CategoryName>(() =>
    readInitialCategory(readInitialSettings().hiddenCategories)
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(readInitialFavorites);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSyncingExternal, setIsSyncingExternal] = useState(false);
  const [isAiDiscovering, setIsAiDiscovering] = useState(false);
  const [isLoadingVod, setIsLoadingVod] = useState(false);
  const [isAiDiscoveringVod, setIsAiDiscoveringVod] = useState(false);
  const [isResolvingLogos, setIsResolvingLogos] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [pauseSignal, setPauseSignal] = useState(0);
  const isOnline = useOnlineStatus();
  const [favSubView, setFavSubView] = useState<'favorites' | 'recent'>('favorites');
  const [recentNames, setRecentNames] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_RECENT_CHANNELS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const [epgReminders, setEpgReminders] = useState<EpgReminderItem[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_EPG_REMINDERS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? (arr as EpgReminderItem[]) : [];
    } catch {
      return [];
    }
  });
  const [activeReminderAlert, setActiveReminderAlert] = useState<EpgReminderItem | null>(null);

  // External GitHub JSON / M3U bulk sources (auto-synced & merged into channel list)
  const [externalSources, setExternalSources] = useState<ExternalListSource[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_EXTERNAL_SOURCES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ExternalListSource[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const existingIds = new Set(parsed.map((s) => s.id));
          const missingPresets = DEFAULT_EXTERNAL_SOURCES.filter(
            (p) => !existingIds.has(p.id)
          );
          return missingPresets.length > 0 ? [...parsed, ...missingPresets] : parsed;
        }
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
  const vodItemsRef = useRef<VodItem[]>(vodItems);
  vodItemsRef.current = vodItems;
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
  const [visibleCount, setVisibleCount] = useState(() =>
    readInitialSettings().lowRamMode ? 40 : 80
  );

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
  const lastFocusedChannelIdRef = useRef<string | null>(null);
  const lastFocusedVodIdRef = useRef<string | null>(null);
  const lastFocusedBeforeModalRef = useRef<HTMLElement | null>(null);
  const wasAnyModalOpenRef = useRef(false);

  const handleChannelPerfEvent = useCallback(
    (ch: Channel, event: ChannelPerfEvent) => {
      setPerfMap((prev) => {
        const next = recordChannelPerfEvent(prev, ch, event);
        saveChannelPerfMap(next);
        return next;
      });
    },
    []
  );

  const handleResetPerformanceStats = useCallback(() => {
    setPerfMap({});
    clearChannelPerfMap();
    setStatusMessage('Kanal performans derecelendirme verileri sıfırlandı.');
  }, []);

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
    setRecentNames((prev) => {
      const filtered = prev.filter((n) => n !== currentChannel.name);
      const next = [currentChannel.name, ...filtered].slice(0, 20);
      try {
        localStorage.setItem(STORAGE_RECENT_CHANNELS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [currentChannel]);

  const toggleEpgReminder = useCallback((item: EpgReminderItem) => {
    setEpgReminders((prev) => {
      const exists = prev.some((r) => r.id === item.id);
      const next = exists ? prev.filter((r) => r.id !== item.id) : [...prev, item];
      try {
        localStorage.setItem(STORAGE_EPG_REMINDERS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Poll EPG reminders every 20s and notify user when a scheduled programme begins
  useEffect(() => {
    if (epgReminders.length === 0) return;
    const check = () => {
      const now = Date.now();
      const due = epgReminders.find((r) => r.startMs <= now && r.stopMs > now);
      if (due) {
        setActiveReminderAlert(due);
        setEpgReminders((prev) => {
          const next = prev.filter((r) => r.id !== due.id && r.stopMs > now);
          try {
            localStorage.setItem(STORAGE_EPG_REMINDERS_KEY, JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
      }
    };
    check();
    const id = window.setInterval(check, 20_000);
    return () => window.clearInterval(id);
  }, [epgReminders]);

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

  const { allChannels, blockedAdultCount } = useMemo(() => {
    const extraLists: Channel[] = [];
    for (const src of externalSources) {
      if (src.enabled && Array.isArray(externalChannelsMap[src.id])) {
        const list =
          src.id === 'builtin_github_kurdish'
            ? externalChannelsMap[src.id].map((ch) => ({
                ...ch,
                smartCategory: 'Kürtçe Yayınlar',
              }))
            : externalChannelsMap[src.id];
        extraLists.push(...list);
      }
    }
    const baseMerged = mergeChannelLists(m3uChannels, extraLists);
    const mergedRadios = [
      ...kurdishRadios.map((r) => ({ ...r, smartCategory: 'Kürtçe Yayınlar' })),
      ...onlineRadios,
    ];
    let combined = baseMerged;
    if (settings.mergeOnlineRadiosToChannels && mergedRadios.length > 0) {
      const existingNames = new Set(
        baseMerged.map((c) => c.name.toLocaleLowerCase('tr-TR'))
      );
      const extras = mergedRadios.filter(
        (r) => !existingNames.has(r.name.toLocaleLowerCase('tr-TR'))
      );
      combined = [...baseMerged, ...extras];
    }
    if (!settings.hideAdultContent) {
      return { allChannels: combined, blockedAdultCount: 0 };
    }
    let blocked = 0;
    const clean: Channel[] = [];
    for (const ch of combined) {
      if (isAdultContent(ch.name, ch.originalGroup, ch.streamUrl, ch.tags)) {
        blocked++;
      } else {
        clean.push(ch);
      }
    }
    return { allChannels: clean, blockedAdultCount: blocked };
  }, [
    m3uChannels,
    externalSources,
    externalChannelsMap,
    onlineRadios,
    kurdishRadios,
    settings.mergeOnlineRadiosToChannels,
    settings.hideAdultContent,
  ]);

  const safeVodItems = useMemo(
    () =>
      settings.hideAdultContent
        ? vodItems.filter(
            (v) => !isAdultContent(v.name, `${v.originalGroup} ${v.autoCategory}`, v.streamUrl)
          )
        : vodItems,
    [vodItems, settings.hideAdultContent]
  );

  const safeXtreamSeries = useMemo(
    () =>
      settings.hideAdultContent
        ? xtreamSeries.filter((s) => !isAdultContent(s.name, s.category))
        : xtreamSeries,
    [xtreamSeries, settings.hideAdultContent]
  );

  const safeOnlineRadios = useMemo(
    () =>
      settings.hideAdultContent
        ? onlineRadios.filter((r) => !isAdultContent(r.name, r.originalGroup, r.streamUrl, r.tags))
        : onlineRadios,
    [onlineRadios, settings.hideAdultContent]
  );

  const safeKurdishRadios = useMemo(
    () =>
      settings.hideAdultContent
        ? kurdishRadios.filter((r) => !isAdultContent(r.name, r.originalGroup, r.streamUrl, r.tags))
        : kurdishRadios,
    [kurdishRadios, settings.hideAdultContent]
  );

  const safeGlobalRadios = useMemo(
    () =>
      settings.hideAdultContent
        ? globalRadios.filter((r) => !isAdultContent(r.name, r.originalGroup, r.streamUrl, r.tags))
        : globalRadios,
    [globalRadios, settings.hideAdultContent]
  );

  // Immediately clear/switch currentChannel if +18 adult filter blocks it
  useEffect(() => {
    if (!settings.hideAdultContent || !currentChannel) return;
    if (
      isAdultContent(
        currentChannel.name,
        currentChannel.originalGroup,
        currentChannel.streamUrl,
        currentChannel.tags
      )
    ) {
      setCurrentChannel(allChannels[0] ?? null);
    }
  }, [settings.hideAdultContent, currentChannel, allChannels]);

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

  const toggleSmartGroupFilter = useCallback(
    (cat: CategoryName) => {
      if (cat === 'Tümü') {
        updateSettings({ smartGroupFilters: [] });
        setSelectedCategory('Tümü');
        return;
      }
      setSelectedCategory('Tümü');
      const exists = settings.smartGroupFilters.includes(cat);
      const next = exists
        ? settings.smartGroupFilters.filter((c) => c !== cat)
        : [...settings.smartGroupFilters, cat];
      updateSettings({ smartGroupFilters: next });
    },
    [settings.smartGroupFilters, updateSettings]
  );

  const activeSmartGroups = settings.smartGroupFilters;

  const { filteredChannels, groupTotals, showGroupHeaders } = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    const hiddenSet = new Set(settings.hiddenCategories);
    const hasMultiFilter = activeSmartGroups.length > 0;
    const multiFilterSet = new Set(activeSmartGroups);

    const matched = allChannels.filter((ch) => {
      if (hasMultiFilter) {
        const matchesAnySelected =
          (multiFilterSet.has('Favoriler') && favoriteIds.has(ch.name)) ||
          multiFilterSet.has(ch.smartCategory as CategoryName);
        if (!matchesAnySelected) return false;
      } else {
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
        if (!matchesCat) return false;
      }

      if (!q) return true;
      return (
        ch.name.toLocaleLowerCase('tr-TR').includes(q) ||
        ch.smartCategory.toLocaleLowerCase('tr-TR').includes(q) ||
        ch.originalGroup.toLocaleLowerCase('tr-TR').includes(q)
      );
    });

    const multiCategoryMode = hasMultiFilter
      ? activeSmartGroups.length > 1
      : selectedCategory === 'Tümü';
    const shouldGroup = settings.groupChannelsByCategory && multiCategoryMode;

    if (!shouldGroup) {
      const orderedFlat = settings.performanceSortEnabled
        ? sortChannelsByPerformance(matched, perfMap)
        : matched;
      return {
        filteredChannels: orderedFlat,
        groupTotals: new Map<string, number>(),
        showGroupHeaders: false,
      };
    }

    const orderMap = new Map<string, number>(
      CATEGORIES.map((c, idx) => [c, idx])
    );
    const buckets = new Map<string, Channel[]>();
    for (const ch of matched) {
      const key = ch.smartCategory || 'Yerel & Diğer';
      const arr = buckets.get(key);
      if (arr) arr.push(ch);
      else buckets.set(key, [ch]);
    }
    const sortedEntries = [...buckets.entries()].sort(
      (a, b) => (orderMap.get(a[0]) ?? 99) - (orderMap.get(b[0]) ?? 99)
    );
    const ordered: Channel[] = [];
    const totals = new Map<string, number>();
    for (const [grp, list] of sortedEntries) {
      totals.set(grp, list.length);
      const sortedBucket = settings.performanceSortEnabled
        ? sortChannelsByPerformance(list, perfMap)
        : list;
      ordered.push(...sortedBucket);
    }

    return {
      filteredChannels: ordered,
      groupTotals: totals,
      showGroupHeaders: sortedEntries.length > 1,
    };
  }, [
    allChannels,
    selectedCategory,
    activeSmartGroups,
    settings.groupChannelsByCategory,
    settings.performanceSortEnabled,
    perfMap,
    searchQuery,
    favoriteIds,
    settings.hiddenCategories,
  ]);

  const favoriteChannels = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    const seenNames = new Set<string>();
    const collected: Channel[] = [];
    const pool: Channel[] = [
      ...allChannels,
      ...safeOnlineRadios,
      ...safeKurdishRadios,
      ...safeGlobalRadios,
      ...safeVodItems.map((item) => vodItemToChannel(item)),
    ];
    for (const ch of pool) {
      if (!favoriteIds.has(ch.name)) continue;
      const key = ch.name.toLocaleLowerCase('tr-TR');
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      if (
        q &&
        !ch.name.toLocaleLowerCase('tr-TR').includes(q) &&
        !ch.smartCategory.toLocaleLowerCase('tr-TR').includes(q)
      ) {
        continue;
      }
      collected.push(ch);
    }
    return settings.performanceSortEnabled
      ? sortChannelsByPerformance(collected, perfMap)
      : collected;
  }, [
    allChannels,
    safeOnlineRadios,
    safeKurdishRadios,
    safeGlobalRadios,
    safeVodItems,
    favoriteIds,
    searchQuery,
    settings.performanceSortEnabled,
    perfMap,
  ]);

  const recentChannels = useMemo(() => {
    if (recentNames.length === 0) return [];
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    const poolByName = new Map<string, Channel>();
    for (const ch of [
      ...allChannels,
      ...safeOnlineRadios,
      ...safeKurdishRadios,
      ...safeGlobalRadios,
      ...safeVodItems.map((item) => vodItemToChannel(item)),
    ]) {
      const key = ch.name.toLocaleLowerCase('tr-TR');
      if (!poolByName.has(key)) poolByName.set(key, ch);
    }
    const ordered: Channel[] = [];
    for (const name of recentNames) {
      const found = poolByName.get(name.toLocaleLowerCase('tr-TR'));
      if (!found) continue;
      if (
        q &&
        !found.name.toLocaleLowerCase('tr-TR').includes(q) &&
        !found.smartCategory.toLocaleLowerCase('tr-TR').includes(q)
      ) {
        continue;
      }
      ordered.push(found);
    }
    return ordered;
  }, [
    recentNames,
    allChannels,
    safeOnlineRadios,
    safeKurdishRadios,
    safeGlobalRadios,
    safeVodItems,
    searchQuery,
  ]);

  useEffect(() => {
    setVisibleCount(settings.lowRamMode ? 40 : 80);
    if (listContainerRef.current) {
      listContainerRef.current.scrollTop = 0;
    }
  }, [
    selectedCategory,
    activeSmartGroups,
    settings.groupChannelsByCategory,
    searchQuery,
    settings.lowRamMode,
  ]);

  const channelsWithLogoCount = useMemo(
    () => allChannels.filter((c) => !isDeadLogoUrl(c.logoUrl)).length,
    [allChannels]
  );

  const enrichCurrentChannelLogo = useCallback((updatedPool: Channel[]) => {
    setCurrentChannel((prev) => {
      if (!prev || !isDeadLogoUrl(prev.logoUrl)) return prev;
      const found = updatedPool.find((c) => c.name === prev.name && !isDeadLogoUrl(c.logoUrl));
      return found ? { ...prev, logoUrl: found.logoUrl } : prev;
    });
  }, []);

  const applyParsedChannels = useCallback(
    (parsed: Channel[], preserveCurrent: boolean, allowAutoPlay: boolean) => {
      const instant = applyCachedLogosToChannels(parsed);
      setM3uChannels(instant);
      setCurrentChannel((prev) => {
        if (preserveCurrent && prev) {
          const match = instant.find((c) => c.name === prev.name);
          if (match) return match;
        }
        if (!allowAutoPlay && !prev) {
          return null;
        }
        if (settings.resumeLastChannel) {
          try {
            const lastName = localStorage.getItem(STORAGE_LAST_CHANNEL_KEY);
            if (lastName) {
              const resumed = instant.find((c) => c.name === lastName);
              if (resumed) return resumed;
            }
          } catch {
            // ignore
          }
        }
        return (
          instant.find((c) => c.name.toUpperCase().includes('TRT 1 HD')) ??
          instant[0] ??
          null
        );
      });

      // Automatically resolve missing or dead (huhu.to) channel logos in background
      void resolveAndAttachChannelLogos(instant).then(({ updated, newlyMatched }) => {
        if (newlyMatched > 0) {
          setM3uChannels(updated);
          enrichCurrentChannelLogo(updated);
        }
      });
    },
    [settings.resumeLastChannel, enrichCurrentChannelLogo]
  );

  const loadDefaultPlaylist = useCallback(async () => {
    const res = await fetch('/api/playlist/default', { cache: 'no-store' });
    if (!res.ok) throw new Error('Varsayılan liste yüklenemedi');
    const text = await res.text();
    return parseM3u(text);
  }, []);

  const loadOnlineRadios = useCallback(
    async (scope: 'tr' | 'global' | 'kurdish', forceRefresh = false) => {
      setIsLoadingRadios(true);
      try {
        const res = await fetch(
          `/api/radios/online?scope=${scope}${forceRefresh ? '&refresh=1' : ''}`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { stations?: OnlineRadioDto[] };
        const mapped = applyCachedLogosToChannels(
          (data.stations || []).map(mapOnlineRadioToChannel)
        );
        const setTarget = (list: Channel[]) => {
          if (scope === 'global') {
            setGlobalRadios(list);
          } else if (scope === 'kurdish') {
            setKurdishRadios(
              list.map((r) => ({ ...r, smartCategory: 'Kürtçe Yayınlar' }))
            );
          } else {
            setOnlineRadios(list);
          }
        };
        setTarget(mapped);
        void resolveAndAttachChannelLogos(mapped).then(({ updated, newlyMatched }) => {
          if (newlyMatched > 0) {
            setTarget(updated);
            enrichCurrentChannelLogo(updated);
          }
        });
      } catch {
        // Keep existing radio list
      } finally {
        setIsLoadingRadios(false);
      }
    },
    [enrichCurrentChannelLogo]
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

  const persistExternalCache = useCallback(
    (cache: Record<string, Channel[]>) => {
      setExternalChannelsMap(cache);
      try {
        const cappedCache: Record<string, Channel[]> = {};
        const maxPerSource = settings.lowRamMode ? 450 : 1200;
        for (const [k, list] of Object.entries(cache)) {
          cappedCache[k] = Array.isArray(list) ? list.slice(0, maxPerSource) : [];
        }
        localStorage.setItem(STORAGE_EXTERNAL_CACHE_KEY, JSON.stringify(cappedCache));
      } catch {
        // ignore storage quota errors on huge lists
      }
    },
    [settings.lowRamMode]
  );

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
          const parsed = applyCachedLogosToChannels(
            parseM3u(r.content).map((ch) => ({
              ...ch,
              id: `${src.id}_${ch.id}`,
              smartCategory:
                src.id === 'builtin_github_kurdish'
                  ? 'Kürtçe Yayınlar'
                  : ch.smartCategory,
              source: (r.format === 'json' ? 'github-json' : 'external') as Channel['source'],
            }))
          );
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

        // Background auto-logo discovery for newly synced external sources
        void (async () => {
          const enrichedCache: Record<string, Channel[]> = { ...nextCache };
          let anyChanged = false;
          for (const [sid, list] of Object.entries(nextCache)) {
            const resLogos = await resolveAndAttachChannelLogos(list);
            if (resLogos.newlyMatched > 0) {
              enrichedCache[sid] = resLogos.updated;
              anyChanged = true;
            }
          }
          if (anyChanged) {
            persistExternalCache(enrichedCache);
          }
        })();
      } catch {
        // Keep cached lists if temporarily offline
      } finally {
        setIsSyncingExternal(false);
      }
    },
    [externalSources, externalChannelsMap, persistExternalCache, persistExternalSources]
  );

  const handleAutoFindAllLogos = useCallback(async () => {
    setIsResolvingLogos(true);
    try {
      let totalFound = 0;
      const m3uRes = await resolveAndAttachChannelLogos(m3uChannels, true);
      if (m3uRes.newlyMatched > 0 || m3uRes.updated !== m3uChannels) {
        setM3uChannels(m3uRes.updated);
        enrichCurrentChannelLogo(m3uRes.updated);
        totalFound += m3uRes.newlyMatched;
      }

      const [trRad, kuRad, glRad] = await Promise.all([
        resolveAndAttachChannelLogos(onlineRadios, true),
        resolveAndAttachChannelLogos(kurdishRadios, true),
        resolveAndAttachChannelLogos(globalRadios, true),
      ]);
      if (trRad.newlyMatched > 0) {
        setOnlineRadios(trRad.updated);
        totalFound += trRad.newlyMatched;
      }
      if (kuRad.newlyMatched > 0) {
        setKurdishRadios(kuRad.updated);
        totalFound += kuRad.newlyMatched;
      }
      if (glRad.newlyMatched > 0) {
        setGlobalRadios(glRad.updated);
        totalFound += glRad.newlyMatched;
      }

      const nextExt: Record<string, Channel[]> = { ...externalChannelsMap };
      let extChanged = false;
      for (const [sid, list] of Object.entries(externalChannelsMap)) {
        const resExt = await resolveAndAttachChannelLogos(list, true);
        if (resExt.newlyMatched > 0 || resExt.updated !== list) {
          nextExt[sid] = resExt.updated;
          extChanged = true;
          totalFound += resExt.newlyMatched;
        }
      }
      if (extChanged) {
        persistExternalCache(nextExt);
      }

      setStatusMessage(
        totalFound > 0
          ? `${totalFound} kanal ve radyo için otomatik logo bulundu ve eklendi.`
          : 'Mevcut tüm eşleşebilen kanal logoları zaten ekli.'
      );
    } catch {
      setStatusMessage('Logo arama sırasında bağlantı hatası oluştu.');
    } finally {
      setIsResolvingLogos(false);
    }
  }, [
    m3uChannels,
    onlineRadios,
    kurdishRadios,
    globalRadios,
    externalChannelsMap,
    persistExternalCache,
    enrichCurrentChannelLogo,
  ]);

  const discoverAndAddGithubListsWithAi = useCallback(
    async (
      topic?: string,
      silent = false
    ): Promise<{
      count: number;
      summary: string;
      webSources?: Array<{ title: string; uri: string }>;
      publishedUrl?: string;
    }> => {
      setIsAiDiscovering(true);
      try {
        const res = await fetch('/api/ai/discover-web-lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: topic || undefined,
            existingUrls: externalSources.map((s) => s.url),
            attemptNonce: Date.now(),
          }),
        });
        const data = (await res.json()) as {
          lists?: Array<{
            name: string;
            url: string;
            format: 'm3u' | 'json';
            channelCount: number;
            reason: string;
          }>;
          webSources?: Array<{ title: string; uri: string }>;
          publishedCount?: number;
          publishedUrl?: string;
          summary?: string;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        try {
          localStorage.setItem(STORAGE_AI_LAST_RUN_KEY, String(Date.now()));
        } catch {
          // ignore
        }

        const found = data.lists || [];
        if (found.length === 0) {
          const msg =
            data.summary ||
            "Tüm Web ve GitHub üzerinde eklenecek yeni M3U listesi bulunamadı.";
          if (!silent) setStatusMessage(msg);
          return {
            count: 0,
            summary: msg,
            webSources: data.webSources || [],
            publishedUrl: data.publishedUrl || '/api/export/playlist.m3u8',
          };
        }

        const existingUrls = new Set(externalSources.map((s) => s.url));
        const newSources: ExternalListSource[] = [];
        for (let i = 0; i < found.length; i++) {
          const item = found[i];
          if (existingUrls.has(item.url)) continue;
          existingUrls.add(item.url);
          newSources.push({
            id: `ai_${Date.now()}_${i}`,
            name: item.name,
            url: item.url,
            format: item.format || 'm3u',
            enabled: true,
            autoSync: true,
            channelCount: item.channelCount,
            isAiDiscovered: true,
          });
        }

        if (newSources.length > 0) {
          const nextList = [...externalSources, ...newSources];
          persistExternalSources(nextList);
          await syncExternalSources(nextList);
          const timeLabel = new Date().toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit',
          });
          setLastUpdatedAt(timeLabel);
        }

        const totalFoundChannels = newSources.reduce(
          (acc, x) => acc + (x.channelCount || 0),
          0
        );
        const summary =
          data.summary ||
          `AI Web ve GitHub'dan ${newSources.length} liste (${totalFoundChannels} kanal) buldu, ekledi ve yayınladı.`;
        if (!silent || newSources.length > 0) {
          setStatusMessage(summary);
        }
        return {
          count: newSources.length,
          summary,
          webSources: data.webSources || [],
          publishedUrl: data.publishedUrl || '/api/export/playlist.m3u8',
        };
      } catch (err) {
        if (!silent) {
          const msg = err instanceof Error ? err.message : 'AI web taraması başarısız.';
          setStatusMessage(msg);
          throw err;
        }
        return { count: 0, summary: '', webSources: [] };
      } finally {
        setIsAiDiscovering(false);
      }
    },
    [externalSources, persistExternalSources, syncExternalSources]
  );

  const mergeVodM3uContent = useCallback(
    (m3uContent: string): number => {
      const incoming = parseVodM3u(m3uContent);
      if (incoming.length === 0) return 0;

      const existing = vodItemsRef.current;
      const existingUrls = new Set(existing.map((item) => item.streamUrl));
      const newOnes: VodItem[] = [];
      for (const item of incoming) {
        if (!existingUrls.has(item.streamUrl)) {
          existingUrls.add(item.streamUrl);
          newOnes.push(item);
        }
      }
      if (newOnes.length === 0) return 0;

      const maxCap = settings.lowRamMode ? 350 : 1200;
      const merged = [...newOnes, ...existing].slice(0, maxCap);
      setVodItems(merged);

      try {
        const lines = ['#EXTM3U'];
        for (const item of merged) {
          const safeName = item.name.replace(/[\r\n"]+/g, ' ').trim();
          const safeCat = (item.autoCategory || item.originalGroup || 'Genel Filmler')
            .replace(/"/g, '')
            .trim();
          const prefix = item.type === 'series' ? 'Dizi' : 'Film';
          const groupTitle = safeCat.toLowerCase().includes(prefix.toLowerCase())
            ? safeCat
            : `${prefix} · ${safeCat}`;
          const logoAttr = item.posterUrl
            ? ` tvg-logo="${item.posterUrl.replace(/"/g, '')}"`
            : '';
          lines.push(
            `#EXTINF:-1 tvg-name="${safeName}"${logoAttr} group-title="${groupTitle}",${safeName}`
          );
          lines.push(item.streamUrl);
        }
        localStorage.setItem(STORAGE_VOD_PLAYLIST_KEY, lines.join('\n'));
      } catch {
        // ignore storage quota errors
      }
      return newOnes.length;
    },
    [settings.lowRamMode]
  );

  const loadVodCatalog = useCallback(
    async (forceRefresh = false) => {
      setIsLoadingVod(true);
      try {
        const res = await fetch(
          `/api/vod/catalog${forceRefresh ? '?refresh=1' : ''}`,
          { cache: 'no-store' }
        );
        const data = (await res.json()) as {
          content?: string;
          count?: number;
          aiCount?: number;
          error?: string;
        };
        if (!res.ok || !data.content) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const added = mergeVodM3uContent(data.content);
        if (forceRefresh) {
          setStatusMessage(
            added > 0
              ? `Film & Dizi kataloğu güncellendi: ${added} yeni içerik eklendi.`
              : `Film & Dizi kataloğu güncel (${vodItemsRef.current.length} içerik).`
          );
        }
      } catch (err) {
        if (forceRefresh) {
          setStatusMessage(
            err instanceof Error ? err.message : 'Film & Dizi kataloğu yüklenemedi.'
          );
        }
      } finally {
        setIsLoadingVod(false);
      }
    },
    [mergeVodM3uContent]
  );

  const discoverVodWithAi = useCallback(
    async (
      topic?: string,
      silent = false
    ): Promise<{
      addedCount: number;
      summary: string;
      webSources?: Array<{ title: string; uri: string }>;
    }> => {
      setIsAiDiscoveringVod(true);
      try {
        const res = await fetch('/api/ai/discover-vod', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: topic || undefined,
            existingUrls: vodItemsRef.current.map((v) => v.streamUrl).slice(0, 300),
            attemptNonce: Date.now(),
          }),
        });
        const data = (await res.json()) as {
          m3uContent?: string;
          addedCount?: number;
          verifiedCount?: number;
          totalAiCount?: number;
          webSources?: Array<{ title: string; uri: string }>;
          summary?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const added = data.m3uContent ? mergeVodM3uContent(data.m3uContent) : 0;
        const summary =
          data.summary ||
          (added > 0
            ? `Yapay zeka ${added} yeni film/diziyi düzenledi ve bağladı.`
            : 'Film & Dizi kataloğu tarandı ve doğrulandı.');
        if (!silent || added > 0) {
          setStatusMessage(summary);
        }
        return {
          addedCount: added || data.addedCount || 0,
          summary,
          webSources: data.webSources || [],
        };
      } catch (err) {
        if (!silent) {
          const msg =
            err instanceof Error ? err.message : 'AI film/dizi taraması başarısız.';
          setStatusMessage(msg);
          throw err;
        }
        return { addedCount: 0, summary: '', webSources: [] };
      } finally {
        setIsAiDiscoveringVod(false);
      }
    },
    [mergeVodM3uContent]
  );

  // Fast startup: load primary channels immediately so first stream plays fast, then stagger radios/EPG/external/AI
  useEffect(() => {
    let cancelled = false;
    let bgTimer1: number | null = null;
    let bgTimer2: number | null = null;
    let bgTimer3: number | null = null;

    const scheduleBackgroundWork = () => {
      if (cancelled) return;
      bgTimer1 = window.setTimeout(() => {
        if (cancelled) return;
        void loadOnlineRadios('tr', false);
        void loadOnlineRadios('kurdish', false);
        if (vodItemsRef.current.length < 10) {
          void loadVodCatalog(false);
        }
      }, 350);

      bgTimer2 = window.setTimeout(() => {
        if (cancelled) return;
        if (settings.epgEnabled) {
          void loadOnlineEpg(settings.epgUrl, false);
        }
        if (settings.autoSyncExternalLists) {
          void syncExternalSources();
        }
      }, 950);

      bgTimer3 = window.setTimeout(() => {
        if (cancelled || !settings.aiAutoDiscoverGithub) return;
        try {
          const lastRun = Number(localStorage.getItem(STORAGE_AI_LAST_RUN_KEY) || '0');
          // Run background AI discovery at most once per 24h automatically unless triggered manually
          if (!lastRun || Date.now() - lastRun > 24 * 60 * 60 * 1000) {
            void discoverAndAddGithubListsWithAi(undefined, true);
          }
        } catch {
          // ignore
        }
        if (vodItemsRef.current.length < 25) {
          void discoverVodWithAi(undefined, true);
        }
      }, 2400);
    };

    const init = async () => {
      setIsLoading(true);
      const storedUrl = savedUrl.trim();
      const shouldForceUpdate = Boolean(storedUrl) && mandatoryAutoUpdate;

      if (shouldForceUpdate) {
        try {
          await fetchRemoteM3u(storedUrl, false);
          if (!cancelled) {
            setIsLoading(false);
            scheduleBackgroundWork();
          }
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
            scheduleBackgroundWork();
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
        if (!cancelled) {
          setIsLoading(false);
          scheduleBackgroundWork();
        }
      }
    };

    void init();
    return () => {
      cancelled = true;
      if (bgTimer1 !== null) window.clearTimeout(bgTimer1);
      if (bgTimer2 !== null) window.clearTimeout(bgTimer2);
      if (bgTimer3 !== null) window.clearTimeout(bgTimer3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic background EPG refresh every 10 minutes
  useEffect(() => {
    if (isAppClosed) return;
    if (!settings.epgEnabled) {
      setEpgMap({});
      return;
    }
    if (Object.keys(epgMap).length === 0 && !isLoadingEpg) {
      void loadOnlineEpg(settings.epgUrl, false);
    }
    const id = window.setInterval(() => {
      if (!isAppClosed) {
        void loadOnlineEpg(settings.epgUrl, false);
      }
    }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.epgEnabled, settings.epgUrl, isAppClosed]);

  // Ensure Film & Dizi auto-populates immediately when user opens the VOD tab
  useEffect(() => {
    if (isAppClosed) return;
    if (activeTab === 'vod' && vodItems.length === 0 && !isLoadingVod) {
      void loadVodCatalog(false);
    }
  }, [activeTab, vodItems.length, isLoadingVod, isAppClosed, loadVodCatalog]);

  // Continuous background AI Film & Dizi scraping/categorization (every 12 minutes when enabled)
  useEffect(() => {
    if (isAppClosed || !settings.aiAutoDiscoverGithub) {
      return;
    }
    const id = window.setInterval(() => {
      if (!isAppClosed) {
        void discoverVodWithAi(undefined, true);
      }
    }, 12 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [isAppClosed, settings.aiAutoDiscoverGithub, discoverVodWithAi]);

  // Periodic background M3U + External GitHub JSON/M3U + VOD catalog auto-update
  useEffect(() => {
    if (isAppClosed || settings.autoRefreshMinutes <= 0) {
      return;
    }
    const id = window.setInterval(() => {
      if (isAppClosed) return;
      if (savedUrl.trim() && mandatoryAutoUpdate) {
        void fetchRemoteM3u(savedUrl, true).catch(() => {});
      }
      if (settings.autoSyncExternalLists) {
        void syncExternalSources();
      }
      void loadVodCatalog(false);
    }, settings.autoRefreshMinutes * 60 * 1000);
    return () => window.clearInterval(id);
  }, [
    isAppClosed,
    savedUrl,
    mandatoryAutoUpdate,
    settings.autoRefreshMinutes,
    settings.autoSyncExternalLists,
    fetchRemoteM3u,
    syncExternalSources,
    loadVodCatalog,
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
    if (activeTab === 'favorites') {
      return favoriteChannels.length > 0 ? favoriteChannels : allChannels;
    }
    if (activeTab === 'radio') {
      const radioPool = [...safeOnlineRadios, ...safeKurdishRadios, ...safeGlobalRadios];
      return radioPool.length > 0 ? radioPool : allChannels;
    }
    return filteredChannels.length > 0 ? filteredChannels : allChannels;
  }, [
    activeTab,
    favoriteChannels,
    safeOnlineRadios,
    safeKurdishRadios,
    safeGlobalRadios,
    filteredChannels,
    allChannels,
  ]);

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
      const normalized = normalizeInputUrl(url);
      if (!normalized) return;
      setSavedUrl(normalized);
      setMandatoryAutoUpdate(mandatory);
      try {
        localStorage.setItem(STORAGE_URL_KEY, normalized);
        localStorage.setItem(STORAGE_MANDATORY_KEY, String(mandatory));
      } catch {
        // ignore
      }
      void fetchRemoteM3u(normalized, false).catch(() => {});
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
        .filter(
          (s) =>
            /^https?:\/\//i.test(s) ||
            /^(\d{1,3}(\.\d{1,3}){3}|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(:\d+)?(\/|$|#|\?)/i.test(s)
        )
        .map((s) => normalizeInputUrl(s))
        .filter(Boolean);

      if (rawLines.length === 0) {
        throw new Error('Geçerli http:// veya https:// adres bulunamadı.');
      }

      const existingUrls = new Set(externalSources.map((s) => s.url));
      const added: ExternalListSource[] = [];
      for (let i = 0; i < rawLines.length; i++) {
        const normalized = normalizeGithubRawUrl(rawLines[i]);
        if (existingUrls.has(normalized)) continue;
        existingUrls.add(normalized);
        const cleanPathUrl = normalized.split('#')[0];
        let derivedName = `Ek Liste ${i + 1}`;
        try {
          const parsedUrl = new URL(cleanPathUrl);
          const segments = parsedUrl.pathname.split('/').filter(Boolean);
          const lastSeg = segments[segments.length - 1] || '';
          if (lastSeg === 'repo.json' && segments.length >= 2) {
            derivedName = `${segments[1]} · Repo`;
          } else if (lastSeg && lastSeg !== '/') {
            derivedName = lastSeg;
          } else {
            derivedName = parsedUrl.hostname;
          }
        } catch {
          derivedName = cleanPathUrl.split('/').pop()?.split('?')[0] || `Ek Liste ${i + 1}`;
        }
        const label =
          customName && rawLines.length === 1
            ? customName
            : customName
            ? `${customName} #${i + 1}`
            : derivedName;
        added.push({
          id: `ext_${Date.now()}_${i}`,
          name: label,
          url: cleanPathUrl,
          format: cleanPathUrl.toLowerCase().endsWith('.json') ? 'json' : 'auto',
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
      const tagged = applyCachedLogosToChannels(
        parsed.map((ch) => ({
          ...ch,
          id: `${sourceId}_${ch.id}`,
          source: (isJson ? 'github-json' : 'external') as Channel['source'],
        }))
      );
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
      const nextCache = { ...externalChannelsMap, [sourceId]: tagged };
      persistExternalCache(nextCache);
      persistExternalSources([...externalSources, newSrc]);
      setStatusMessage(`${filename} ek liste olarak eklendi: ${tagged.length} kanal.`);
      void resolveAndAttachChannelLogos(tagged).then(({ updated, newlyMatched }) => {
        if (newlyMatched > 0) {
          persistExternalCache({ ...nextCache, [sourceId]: updated });
        }
      });
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

  // TV Remote / Mobile Back Button Guard & 5-Second Auto-Close Idle Menus
  const isAnyModalOpen =
    showUrlDialog || showVodModal || showSleepDialog || showEpgDialog || showExitConfirm;

  // Auto-hide top header & auto-close right/left menus after 5s of inactivity during active playback
  useEffect(() => {
    if (!isVideoPlaying || isFullscreen || isAnyModalOpen || isAppClosed) {
      if (!isVideoPlaying) {
        setHeaderAutoHidden(false);
      }
      return;
    }

    const menuWaitSec =
      settings.menuAutoCloseSeconds > 0
        ? settings.menuAutoCloseSeconds
        : currentChannel?.isVod
        ? Math.max(2, settings.hudHideSeconds)
        : 0;

    if (menuWaitSec <= 0) {
      setHeaderAutoHidden(false);
      return;
    }

    let timerId: number | null = null;
    let lastMoveReset = 0;

    const scheduleIdleClose = () => {
      if (timerId !== null) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        const isTouchPrimary =
          typeof window !== 'undefined' &&
          window.matchMedia('(pointer: coarse)').matches &&
          !document.body.classList.contains('tv-remote-active');
        if (isTouchPrimary) {
          return;
        }

        const activeEl = document.activeElement as HTMLElement | null;
        const leftZone = document.querySelector<HTMLElement>('[data-nav-zone="left-vod"]');
        const rightZone = document.querySelector<HTMLElement>('[data-nav-zone="sidepanel"]');
        const headerZone = document.querySelector<HTMLElement>('[data-nav-zone="header"]');
        const focusWasInSideOrHeader = Boolean(
          activeEl &&
            ((leftZone && leftZone.contains(activeEl)) ||
              (rightZone && rightZone.contains(activeEl)) ||
              (headerZone && headerZone.contains(activeEl)))
        );

        setHeaderAutoHidden(true);
        if (
          settings.menuAutoCloseSeconds > 0 &&
          (window.innerWidth >= 768 ||
            window.matchMedia('(orientation: landscape)').matches)
        ) {
          setIsSidePanelOpen(false);
          setIsLeftVodOpen(false);
        }

        if (focusWasInSideOrHeader) {
          window.setTimeout(() => {
            const playEl = document.querySelector<HTMLElement>('[data-player-play="true"]');
            playEl?.focus();
          }, 50);
        }
      }, menuWaitSec * 1000);
    };

    const onMenuActivity = (e: Event) => {
      if (e.type === 'mousemove') {
        const now = Date.now();
        if (now - lastMoveReset < 400) return;
        lastMoveReset = now;
      }
      scheduleIdleClose();
    };

    scheduleIdleClose();
    window.addEventListener('pointerdown', onMenuActivity, { passive: true });
    window.addEventListener('touchstart', onMenuActivity, { passive: true });
    window.addEventListener('keydown', onMenuActivity);
    window.addEventListener('input', onMenuActivity);
    window.addEventListener('change', onMenuActivity);
    window.addEventListener('wheel', onMenuActivity, { passive: true });
    window.addEventListener('scroll', onMenuActivity, { capture: true, passive: true });
    window.addEventListener('mousemove', onMenuActivity, { passive: true });

    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
      window.removeEventListener('pointerdown', onMenuActivity);
      window.removeEventListener('touchstart', onMenuActivity);
      window.removeEventListener('keydown', onMenuActivity);
      window.removeEventListener('input', onMenuActivity);
      window.removeEventListener('change', onMenuActivity);
      window.removeEventListener('wheel', onMenuActivity);
      window.removeEventListener('scroll', onMenuActivity, { capture: true });
      window.removeEventListener('mousemove', onMenuActivity);
    };
  }, [
    isVideoPlaying,
    isFullscreen,
    isAnyModalOpen,
    isAppClosed,
    isSidePanelOpen,
    isLeftVodOpen,
    currentChannel?.id,
    currentChannel?.isVod,
    settings.menuAutoCloseSeconds,
    settings.hudHideSeconds,
  ]);

  const isVisibleFocusable = useCallback((el: HTMLElement | null): boolean => {
    if (!el || !el.isConnected || el.hasAttribute('disabled')) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, []);

  const getZoneFocusables = useCallback(
    (container: HTMLElement | null): HTMLElement[] => {
      if (!container) return [];
      const nodes = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
        )
      );
      return nodes.filter((el) => isVisibleFocusable(el));
    },
    [isVisibleFocusable]
  );

  const recoverLostFocus = useCallback((): HTMLElement | null => {
    if (isFullscreen || isAppClosed) return null;

    if (isAnyModalOpen) {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      const activeDialog = dialogs[dialogs.length - 1];
      if (activeDialog && !activeDialog.contains(document.activeElement)) {
        const first = getZoneFocusables(activeDialog)[0];
        first?.focus();
        return first ?? null;
      }
      return null;
    }

    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && isVisibleFocusable(active)) {
      return active;
    }

    const listZone = document.querySelector<HTMLElement>('[data-nav-zone="list"]');
    if (listZone && isVisibleFocusable(listZone)) {
      const savedChId = lastFocusedChannelIdRef.current || currentChannel?.id;
      if (savedChId) {
        const chRow = listZone.querySelector<HTMLElement>(
          `[data-channel-id="${CSS.escape(savedChId)}"]`
        );
        if (chRow && isVisibleFocusable(chRow)) {
          chRow.focus();
          return chRow;
        }
      }
      const firstRow = listZone.querySelector<HTMLElement>('[data-channel-id]');
      if (firstRow && isVisibleFocusable(firstRow)) {
        firstRow.focus();
        return firstRow;
      }
    }

    const panelZone = document.querySelector<HTMLElement>('[data-nav-zone="panel"]');
    if (panelZone) {
      const firstPanel = getZoneFocusables(panelZone)[0];
      if (firstPanel) {
        firstPanel.focus();
        return firstPanel;
      }
    }

    const tabsNav = document.querySelector<HTMLElement>('[data-nav-zone="tabs"]');
    if (tabsNav) {
      const activeTabEl =
        tabsNav.querySelector<HTMLElement>('[aria-current="page"]') ??
        getZoneFocusables(tabsNav)[0];
      if (activeTabEl && isVisibleFocusable(activeTabEl)) {
        activeTabEl.focus();
        return activeTabEl;
      }
    }

    const leftVodZone = document.querySelector<HTMLElement>('[data-nav-zone="left-vod"]');
    if (leftVodZone && isVisibleFocusable(leftVodZone)) {
      if (lastFocusedVodIdRef.current) {
        const vodCard = leftVodZone.querySelector<HTMLElement>(
          `[data-vod-card="${CSS.escape(lastFocusedVodIdRef.current)}"]`
        );
        if (vodCard && isVisibleFocusable(vodCard)) {
          vodCard.focus();
          return vodCard;
        }
      }
      const firstLeft = getZoneFocusables(leftVodZone)[0];
      if (firstLeft) {
        firstLeft.focus();
        return firstLeft;
      }
    }

    const playEl = document.querySelector<HTMLElement>('[data-player-play="true"]');
    if (playEl && isVisibleFocusable(playEl)) {
      playEl.focus();
      return playEl;
    }

    const headerZone = document.querySelector<HTMLElement>('[data-nav-zone="header"]');
    const firstHeader = getZoneFocusables(headerZone)[0];
    if (firstHeader) {
      firstHeader.focus();
      return firstHeader;
    }

    return null;
  }, [
    isFullscreen,
    isAppClosed,
    isAnyModalOpen,
    currentChannel?.id,
    getZoneFocusables,
    isVisibleFocusable,
  ]);

  // Save focus before opening modal & restore when modal closes; auto-focus dialog controls
  useEffect(() => {
    const wasOpen = wasAnyModalOpenRef.current;
    wasAnyModalOpenRef.current = isAnyModalOpen;

    if (!wasOpen && isAnyModalOpen) {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && isVisibleFocusable(active)) {
        lastFocusedBeforeModalRef.current = active;
      }
    } else if (wasOpen && !isAnyModalOpen) {
      const id = window.setTimeout(() => {
        const prev = lastFocusedBeforeModalRef.current;
        if (prev && isVisibleFocusable(prev)) {
          prev.focus();
        } else {
          recoverLostFocus();
        }
      }, 40);
      return () => window.clearTimeout(id);
    }

    if (!isAnyModalOpen) return;
    const id = window.setTimeout(() => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      const activeDialog = dialogs[dialogs.length - 1];
      if (!activeDialog) return;
      if (activeDialog.contains(document.activeElement)) return;
      const firstFocusable = getZoneFocusables(activeDialog)[0];
      firstFocusable?.focus();
    }, 60);
    return () => window.clearTimeout(id);
  }, [
    isAnyModalOpen,
    showUrlDialog,
    showVodModal,
    showSleepDialog,
    showEpgDialog,
    showExitConfirm,
    getZoneFocusables,
    isVisibleFocusable,
    recoverLostFocus,
  ]);

  // Ensure focus never gets orphaned on body when tabs/panels/channel-sort update
  useEffect(() => {
    if (isFullscreen || isAnyModalOpen || isAppClosed) return;
    const id = window.requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      if (
        document.body.classList.contains('tv-remote-active') &&
        (!active || active === document.body || !isVisibleFocusable(active))
      ) {
        recoverLostFocus();
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [
    activeTab,
    isSidePanelOpen,
    isLeftVodOpen,
    filteredChannels,
    isFullscreen,
    isAnyModalOpen,
    isAppClosed,
    isVisibleFocusable,
    recoverLostFocus,
  ]);

  // Track focused channel/VOD card & prevent orphan focus on blur/unmount
  useEffect(() => {
    let rafId: number | null = null;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      const chId = el.getAttribute('data-channel-id');
      if (chId) lastFocusedChannelIdRef.current = chId;
      const vodId = el.getAttribute('data-vod-card');
      if (vodId) lastFocusedVodIdRef.current = vodId;
    };
    const onFocusOut = () => {
      if (!document.body.classList.contains('tv-remote-active')) return;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body || !isVisibleFocusable(active)) {
          recoverLostFocus();
        }
      });
    };

    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
    };
  }, [isVisibleFocusable, recoverLostFocus]);

  // Install Android TV WebView remote bridge & auto-activate TV focus on TV devices
  useEffect(() => {
    const cleanupBridge = installRemoteBridge();
    const activateTvMode = () => {
      if (isTvEnvironment()) {
        document.body.classList.add('tv-remote-active');
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body || !isVisibleFocusable(active)) {
          window.setTimeout(() => {
            recoverLostFocus();
          }, 80);
        }
      }
    };
    activateTvMode();
    window.addEventListener('eymen-tv-ready', activateTvMode);
    return () => {
      cleanupBridge();
      window.removeEventListener('eymen-tv-ready', activateTvMode);
    };
  }, [isVisibleFocusable, recoverLostFocus]);

  // Focus initial channel row once playlist finishes loading on TV devices
  useEffect(() => {
    if (isLoading || filteredChannels.length === 0 || isFullscreen || isAnyModalOpen) return;
    if (!isTvEnvironment() && !document.body.classList.contains('tv-remote-active')) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body || !isVisibleFocusable(active)) {
      const id = window.setTimeout(() => {
        recoverLostFocus();
      }, 60);
      return () => window.clearTimeout(id);
    }
  }, [isLoading, filteredChannels.length, isFullscreen, isAnyModalOpen, isVisibleFocusable, recoverLostFocus]);

  useEffect(() => {
    try {
      if (!window.history.state?.eymenGuard) {
        window.history.pushState({ eymenGuard: true }, '');
      }
    } catch {
      // ignore
    }

    const handlePopState = () => {
      if (isFullscreen) {
        void handleToggleFullscreen(false);
      } else if (showExitConfirm) {
        setShowExitConfirm(false);
      } else if (showUrlDialog) {
        setShowUrlDialog(false);
      } else if (showVodModal) {
        setShowVodModal(false);
      } else if (showSleepDialog) {
        setShowSleepDialog(false);
      } else if (showEpgDialog) {
        setShowEpgDialog(false);
      } else if (isSidePanelOpen && activeTab !== 'channels') {
        setActiveTab('channels');
      } else if (isSidePanelOpen && isVideoPlaying) {
        setIsSidePanelOpen(false);
      } else {
        setShowExitConfirm(true);
      }
      try {
        window.history.pushState({ eymenGuard: true }, '');
      } catch {
        // ignore
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [
    isFullscreen,
    showExitConfirm,
    showUrlDialog,
    showVodModal,
    showSleepDialog,
    showEpgDialog,
    isSidePanelOpen,
    isVideoPlaying,
    activeTab,
    handleToggleFullscreen,
  ]);

  useEffect(() => {
    const onPointerDown = (e: Event) => {
      if (!isTvEnvironment()) {
        if ((e as PointerEvent).pointerType === 'touch' || e.type === 'touchstart') {
          document.body.classList.remove('tv-remote-active');
        }
      }
    };

    const moveSpatialFocus = (
      container: HTMLElement,
      direction: 'up' | 'down' | 'left' | 'right'
    ): HTMLElement | null => {
      const items = getZoneFocusables(container);
      if (items.length === 0) return null;
      const current = document.activeElement as HTMLElement | null;
      if (!current || !items.includes(current)) {
        const first = items[0];
        first.focus();
        first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return first;
      }

      const cRect = current.getBoundingClientRect();
      const cx = cRect.left + cRect.width / 2;
      const cy = cRect.top + cRect.height / 2;

      let best: HTMLElement | null = null;
      let bestScore = Infinity;

      for (const cand of items) {
        if (cand === current) continue;
        const r = cand.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const dx = x - cx;
        const dy = y - cy;

        let valid = false;
        let primary = 0;
        let secondary = 0;
        if (direction === 'down' && dy > 6) {
          valid = true;
          primary = dy;
          secondary = Math.abs(dx);
        } else if (direction === 'up' && dy < -6) {
          valid = true;
          primary = -dy;
          secondary = Math.abs(dx);
        } else if (direction === 'right' && dx > 6) {
          valid = true;
          primary = dx;
          secondary = Math.abs(dy);
        } else if (direction === 'left' && dx < -6) {
          valid = true;
          primary = -dx;
          secondary = Math.abs(dy);
        }

        if (!valid) continue;
        const score = primary + secondary * 2.2;
        if (score < bestScore) {
          bestScore = score;
          best = cand;
        }
      }

      if (best) {
        best.focus();
        best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      return best;
    };

    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (isAnyRemoteNavigationKey(e)) {
        document.body.classList.add('tv-remote-active');
      }

      const target = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;
      const isTextTypingInput = isTextInputElement(activeEl ?? target);
      const dir = getRemoteDirection(e);

      // Reveal auto-hidden header & toggle side panel on Menu / L / M
      if (
        !isFullscreen &&
        !isAnyModalOpen &&
        !isTextTypingInput &&
        (isRemoteMenuKey(e) ||
          e.key === 'm' ||
          e.key === 'M' ||
          e.key === 'l' ||
          e.key === 'L')
      ) {
        e.preventDefault();
        setHeaderAutoHidden(false);
        setIsSidePanelOpen((prev) => {
          const next = !prev;
          if (next) {
            window.setTimeout(() => recoverLostFocus(), 40);
          }
          return next;
        });
        return;
      }

      if (headerAutoHidden && isRemoteMenuKey(e)) {
        setHeaderAutoHidden(false);
      }

      if (isFullscreen) return;

      if (isRemoteBackKey(e, isTextTypingInput)) {
        e.preventDefault();
        if (showExitConfirm) {
          setShowExitConfirm(false);
        } else if (showUrlDialog) {
          setShowUrlDialog(false);
        } else if (showVodModal) {
          setShowVodModal(false);
        } else if (showSleepDialog) {
          setShowSleepDialog(false);
        } else if (showEpgDialog) {
          setShowEpgDialog(false);
        } else if (isSidePanelOpen && activeTab !== 'channels') {
          setActiveTab('channels');
        } else if (isSidePanelOpen && isVideoPlaying) {
          setIsSidePanelOpen(false);
        } else {
          setShowExitConfirm(true);
        }
        return;
      }

      // Spatial navigation & OK activation inside any open modal dialog
      if (isAnyModalOpen) {
        const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
        const dialogEl = dialogs[dialogs.length - 1];
        if (!dialogEl) return;
        if (isTextTypingInput) {
          if (dir === 'down') {
            e.preventDefault();
            moveSpatialFocus(dialogEl, 'down');
          } else if (dir === 'up') {
            e.preventDefault();
            moveSpatialFocus(dialogEl, 'up');
          }
          return;
        }
        if (isRemoteSelectKey(e)) {
          if (!e.defaultPrevented && activeEl && dialogEl.contains(activeEl)) {
            if (triggerElementActivation(activeEl)) {
              e.preventDefault();
            }
          }
          return;
        }
        if (dir) {
          e.preventDefault();
          moveSpatialFocus(dialogEl, dir);
        }
        return;
      }

      const headerZone = document.querySelector<HTMLElement>('[data-nav-zone="header"]');
      const leftVodZone = document.querySelector<HTMLElement>('[data-nav-zone="left-vod"]');
      const stageZone = document.querySelector<HTMLElement>('[data-nav-zone="stage"]');
      const sidePanelZone = document.querySelector<HTMLElement>('[data-nav-zone="sidepanel"]');
      const tabsNav = document.querySelector<HTMLElement>('[data-nav-zone="tabs"]');
      const smartGroupZone = document.querySelector<HTMLElement>('[data-nav-zone="smart-groups"]');
      const listZone = document.querySelector<HTMLElement>('[data-nav-zone="list"]');
      const panelZone = document.querySelector<HTMLElement>('[data-nav-zone="panel"]');

      // Exit text inputs cleanly on D-Pad Down / Up
      if (isTextTypingInput) {
        if (dir === 'down') {
          e.preventDefault();
          if (leftVodZone && leftVodZone.contains(activeEl)) {
            moveSpatialFocus(leftVodZone, 'down');
          } else if (panelZone && panelZone.contains(activeEl)) {
            moveSpatialFocus(panelZone, 'down');
          } else if (smartGroupZone) {
            getZoneFocusables(smartGroupZone)[0]?.focus();
          } else if (listZone) {
            listZone.querySelector<HTMLElement>('[data-channel-id]')?.focus();
          }
        } else if (dir === 'up') {
          e.preventDefault();
          if (leftVodZone && leftVodZone.contains(activeEl)) {
            const moved = moveSpatialFocus(leftVodZone, 'up');
            if (!moved && headerZone && isVisibleFocusable(headerZone)) {
              getZoneFocusables(headerZone)[0]?.focus();
            }
          } else if (panelZone && panelZone.contains(activeEl)) {
            const moved = moveSpatialFocus(panelZone, 'up');
            if (!moved) {
              const tabBtn =
                tabsNav?.querySelector<HTMLElement>('[aria-current="page"]') ??
                getZoneFocusables(tabsNav)[0];
              tabBtn?.focus();
            }
          } else {
            const tabBtn =
              tabsNav?.querySelector<HTMLElement>('[aria-current="page"]') ??
              getZoneFocusables(tabsNav)[0];
            tabBtn?.focus();
          }
        }
        return;
      }

      // Immediate zero-loss focus recovery if activeElement got dropped to body or hidden element
      if (
        (dir || isRemoteSelectKey(e)) &&
        (!activeEl || activeEl === document.body || !isVisibleFocusable(activeEl))
      ) {
        e.preventDefault();
        setHeaderAutoHidden(false);
        if (!isSidePanelOpen && (dir === 'right' || dir === 'down' || isRemoteSelectKey(e))) {
          setIsSidePanelOpen(true);
        }
        window.setTimeout(() => {
          recoverLostFocus();
        }, 25);
        return;
      }

      // Unified OK / Select / DPadCenter / Enter activation for focused buttons, channel rows, VOD cards, checkboxes
      if (isRemoteSelectKey(e)) {
        if (!e.defaultPrevented && activeEl) {
          if (triggerElementActivation(activeEl)) {
            e.preventDefault();
          }
        }
        return;
      }

      if (!dir) return;

      const focusStageAnchor = (): boolean => {
        if (!stageZone) return false;
        const playEl = stageZone.querySelector<HTMLElement>('[data-player-play="true"]');
        if (playEl && isVisibleFocusable(playEl)) {
          playEl.focus();
          return true;
        }
        const firstStage = getZoneFocusables(stageZone)[0];
        if (firstStage) {
          firstStage.focus();
          return true;
        }
        return false;
      };

      const focusLeftVodAnchor = (): boolean => {
        if (!leftVodZone || !isVisibleFocusable(leftVodZone)) return false;
        if (lastFocusedVodIdRef.current) {
          const card = leftVodZone.querySelector<HTMLElement>(
            `[data-vod-card="${CSS.escape(lastFocusedVodIdRef.current)}"]`
          );
          if (card && isVisibleFocusable(card)) {
            card.focus();
            return true;
          }
        }
        const first =
          leftVodZone.querySelector<HTMLElement>('[data-vod-card]') ??
          getZoneFocusables(leftVodZone)[0];
        if (first && isVisibleFocusable(first)) {
          first.focus();
          return true;
        }
        return false;
      };

      const focusRightPanelAnchor = (): boolean => {
        if (!sidePanelZone || !isVisibleFocusable(sidePanelZone)) return false;
        if (listZone && isVisibleFocusable(listZone)) {
          const targetRow =
            (lastFocusedChannelIdRef.current
              ? listZone.querySelector<HTMLElement>(
                  `[data-channel-id="${CSS.escape(lastFocusedChannelIdRef.current)}"]`
                )
              : null) ?? listZone.querySelector<HTMLElement>('[data-channel-id]');
          if (targetRow && isVisibleFocusable(targetRow)) {
            targetRow.focus();
            return true;
          }
        }
        if (panelZone) {
          const firstPanel = getZoneFocusables(panelZone)[0];
          if (firstPanel) {
            firstPanel.focus();
            return true;
          }
        }
        const firstTab =
          tabsNav?.querySelector<HTMLElement>('[aria-current="page"]') ??
          getZoneFocusables(tabsNav)[0];
        if (firstTab && isVisibleFocusable(firstTab)) {
          firstTab.focus();
          return true;
        }
        return false;
      };

      // Zone 0: Header buttons
      if (headerZone && headerZone.contains(activeEl)) {
        e.preventDefault();
        if (dir === 'left' || dir === 'right') {
          moveSpatialFocus(headerZone, dir);
        } else if (dir === 'down') {
          const rect = activeEl?.getBoundingClientRect();
          const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
          if (leftVodZone && isVisibleFocusable(leftVodZone) && cx < window.innerWidth * 0.32) {
            focusLeftVodAnchor();
          } else if (
            sidePanelZone &&
            isVisibleFocusable(sidePanelZone) &&
            cx > window.innerWidth * 0.65
          ) {
            focusRightPanelAnchor();
          } else if (!focusStageAnchor()) {
            if (!focusRightPanelAnchor()) focusLeftVodAnchor();
          }
        }
        return;
      }

      // Zone 1: Left Film & Dizi (VOD)
      if (leftVodZone && leftVodZone.contains(activeEl)) {
        e.preventDefault();
        const moved = moveSpatialFocus(leftVodZone, dir);
        if (!moved) {
          if (dir === 'right') {
            if (!focusStageAnchor()) focusRightPanelAnchor();
          } else if (dir === 'up') {
            setHeaderAutoHidden(false);
            window.setTimeout(() => {
              const hz = document.querySelector<HTMLElement>('[data-nav-zone="header"]');
              getZoneFocusables(hz)[0]?.focus();
            }, 25);
          }
        }
        return;
      }

      // Zone 2: Center Stage (Player OSD / EPG Bar)
      if (stageZone && stageZone.contains(activeEl)) {
        e.preventDefault();
        const moved = moveSpatialFocus(stageZone, dir);
        if (!moved) {
          if (dir === 'left') {
            if (!focusLeftVodAnchor()) {
              if (
                window.innerWidth >= 768 ||
                window.matchMedia('(orientation: landscape)').matches
              ) {
                setHeaderAutoHidden(false);
                setIsLeftVodOpen(true);
                window.setTimeout(() => {
                  const lz = document.querySelector<HTMLElement>('[data-nav-zone="left-vod"]');
                  const card = lz?.querySelector<HTMLElement>('[data-vod-card]');
                  (card ?? getZoneFocusables(lz)[0])?.focus();
                }, 40);
              }
            }
          } else if (dir === 'right') {
            if (!focusRightPanelAnchor()) {
              setHeaderAutoHidden(false);
              setIsSidePanelOpen(true);
              window.setTimeout(() => recoverLostFocus(), 40);
            }
          } else if (dir === 'up') {
            setHeaderAutoHidden(false);
            window.setTimeout(() => {
              const hz = document.querySelector<HTMLElement>('[data-nav-zone="header"]');
              getZoneFocusables(hz)[0]?.focus();
            }, 25);
          }
        }
        return;
      }

      // Zone 3a: Right Panel Top Tabs
      if (tabsNav && tabsNav.contains(activeEl)) {
        e.preventDefault();
        const btns = getZoneFocusables(tabsNav);
        const idx = activeEl ? btns.indexOf(activeEl) : -1;
        if (dir === 'left') {
          if (idx <= 0) {
            if (!focusStageAnchor()) focusLeftVodAnchor();
          } else {
            btns[idx - 1]?.focus();
          }
        } else if (dir === 'right') {
          btns[Math.min(idx + 1, btns.length - 1)]?.focus();
        } else if (dir === 'up') {
          setHeaderAutoHidden(false);
          window.setTimeout(() => {
            const hz = document.querySelector<HTMLElement>('[data-nav-zone="header"]');
            const hBtns = getZoneFocusables(hz);
            hBtns[hBtns.length - 1]?.focus();
          }, 25);
        } else if (dir === 'down') {
          const searchInput = sidePanelZone?.querySelector<HTMLElement>(
            '[data-channel-search="true"]'
          );
          if (searchInput && isVisibleFocusable(searchInput)) {
            searchInput.focus();
          } else if (smartGroupZone && isVisibleFocusable(smartGroupZone)) {
            getZoneFocusables(smartGroupZone)[0]?.focus();
          } else if (panelZone) {
            getZoneFocusables(panelZone)[0]?.focus();
          } else if (listZone) {
            listZone.querySelector<HTMLElement>('[data-channel-id]')?.focus();
          }
        }
        return;
      }

      // Zone 3b: Right Panel Smart Group Filter
      if (smartGroupZone && smartGroupZone.contains(activeEl)) {
        e.preventDefault();
        const moved = moveSpatialFocus(smartGroupZone, dir);
        if (!moved) {
          if (dir === 'down') {
            const firstRow = listZone?.querySelector<HTMLElement>('[data-channel-id]');
            firstRow?.focus();
          } else if (dir === 'up') {
            const searchInput = sidePanelZone?.querySelector<HTMLElement>(
              '[data-channel-search="true"]'
            );
            if (searchInput && isVisibleFocusable(searchInput)) {
              searchInput.focus();
            } else {
              const tabBtn =
                tabsNav?.querySelector<HTMLElement>('[aria-current="page"]') ??
                getZoneFocusables(tabsNav)[0];
              tabBtn?.focus();
            }
          } else if (dir === 'left') {
            if (!focusStageAnchor()) focusLeftVodAnchor();
          }
        }
        return;
      }

      // Zone 3c: Right Panel Channel List (rows + heart button)
      if (listZone && listZone.contains(activeEl)) {
        e.preventDefault();
        const rowEl = activeEl?.closest<HTMLElement>('[data-channel-id]') ?? null;
        const isFavBtn =
          activeEl?.tagName === 'BUTTON' &&
          activeEl.getAttribute('aria-label') === 'Favori';
        const rows = Array.from(
          listZone.querySelectorAll<HTMLElement>('[data-channel-id]')
        );
        const idx = rowEl ? rows.indexOf(rowEl) : -1;

        if (dir === 'right') {
          if (!isFavBtn && rowEl) {
            const favBtn = rowEl.querySelector<HTMLElement>('button[aria-label="Favori"]');
            favBtn?.focus();
          }
          return;
        }
        if (dir === 'left') {
          if (isFavBtn && rowEl) {
            rowEl.focus();
          } else if (!focusStageAnchor()) {
            focusLeftVodAnchor();
          }
          return;
        }
        if (idx !== -1) {
          if (dir === 'down') {
            if (idx >= rows.length - 6 && visibleCount < filteredChannels.length) {
              setVisibleCount((prev) => Math.min(prev + 100, filteredChannels.length));
            }
            const next = rows[Math.min(idx + 1, rows.length - 1)];
            next?.focus();
            next?.scrollIntoView({ block: 'nearest' });
          } else if (dir === 'up') {
            if (idx === 0) {
              if (smartGroupZone && isVisibleFocusable(smartGroupZone)) {
                getZoneFocusables(smartGroupZone)[0]?.focus();
              } else {
                const searchInput = sidePanelZone?.querySelector<HTMLElement>(
                  '[data-channel-search="true"]'
                );
                if (searchInput && isVisibleFocusable(searchInput)) {
                  searchInput.focus();
                } else {
                  const tabBtn =
                    tabsNav?.querySelector<HTMLElement>('[aria-current="page"]') ??
                    getZoneFocusables(tabsNav)[0];
                  tabBtn?.focus();
                }
              }
            } else {
              const prev = rows[idx - 1];
              prev?.focus();
              prev?.scrollIntoView({ block: 'nearest' });
            }
          }
        }
        return;
      }

      // Zone 3d: Radio / Settings / Mobile VOD Panel
      if (panelZone && panelZone.contains(activeEl)) {
        e.preventDefault();
        const moved = moveSpatialFocus(panelZone, dir);
        if (!moved) {
          if (dir === 'up') {
            const activeTabBtn =
              tabsNav?.querySelector<HTMLElement>('[aria-current="page"]') ??
              getZoneFocusables(tabsNav)[0];
            activeTabBtn?.focus();
          } else if (dir === 'left') {
            if (!focusStageAnchor()) focusLeftVodAnchor();
          }
        }
        return;
      }

      // Fallback: focus best visible anchor
      e.preventDefault();
      recoverLostFocus();
    };

    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('keydown', onGlobalKeyDown);
    };
  }, [
    isFullscreen,
    isAnyModalOpen,
    isSidePanelOpen,
    isLeftVodOpen,
    isVideoPlaying,
    showExitConfirm,
    showUrlDialog,
    showVodModal,
    showSleepDialog,
    showEpgDialog,
    activeTab,
    headerAutoHidden,
    visibleCount,
    filteredChannels.length,
    getZoneFocusables,
    isVisibleFocusable,
    recoverLostFocus,
  ]);

  const handleConfirmExit = useCallback(() => {
    setShowExitConfirm(false);
    setPauseSignal((s) => s + 1);
    setIsVideoPlaying(false);
    setMultiScreenLayout(1);
    setMultiSlots([null, null, null, null]);
    setCurrentChannel(null);
    setIsAppClosed(true);

    if (sleepIntervalRef.current !== null) {
      window.clearInterval(sleepIntervalRef.current);
      sleepIntervalRef.current = null;
    }

    try {
      document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((mediaEl) => {
        mediaEl.pause();
        mediaEl.muted = true;
        mediaEl.removeAttribute('src');
        mediaEl.srcObject = null;
        mediaEl.load();
      });
    } catch {
      // ignore
    }

    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      }
    } catch {
      // ignore
    }

    try {
      const win = window as unknown as {
        Android?: { exitApp?: () => void };
      };
      win.Android?.exitApp?.();
      window.close();
    } catch {
      // Browser tab close fallback shows closed standby screen
    }
  }, []);

  if (isAppClosed) {
    return (
      <div className="h-dvh w-full flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--ink)] p-6 text-center space-y-4">
        <AppLogoBadge className="w-16 h-16" />
        <div>
          <h1 className="text-lg font-extrabold">Eymen TV &amp; Radyo Kapatıldı</h1>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Yayın ve tüm arka plan işlemleri durduruldu.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsAppClosed(false);
            setCurrentChannel((prev) => prev ?? allChannels[0] ?? null);
          }}
          className="px-5 py-2.5 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-extrabold hover:bg-[var(--accent-hover)]"
        >
          Uygulamayı Yeniden Aç
        </button>
      </div>
    );
  }

  return (
    <div
      onMouseMove={(e) => {
        if (headerAutoHidden && e.clientY <= 36) {
          setHeaderAutoHidden(false);
        }
      }}
      className="h-dvh w-full flex flex-col bg-[var(--bg)] text-[var(--ink)] overflow-hidden"
    >
      {/* Clean Single-Row Header */}
      <header
        data-nav-zone="header"
        className={`shrink-0 flex items-center justify-between gap-4 bg-[var(--surface-2)] transition-all duration-300 ${
          isFullscreen || headerAutoHidden
            ? 'max-h-0 opacity-0 py-0 px-3.5 border-b-0 overflow-hidden pointer-events-none'
            : 'max-h-16 opacity-100 px-3 sm:px-4 py-2 border-b border-[var(--border)]'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <AppLogoBadge className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" />
          <h1 className="text-[14px] sm:text-base font-extrabold tracking-tight text-[var(--ink)] whitespace-nowrap truncate">
            EYMEN TV &amp; RADYO
          </h1>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {sleepMinutes !== null && (
            <button
              type="button"
              onClick={() => setShowSleepDialog(true)}
              title="Uyku Zamanlayıcı Aktif"
              className="font-mono-nums px-2 py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--accent)] text-[11px] font-bold"
            >
              {sleepMinutes}dk
            </button>
          )}

          <button
            type="button"
            onClick={handleToggleMultiScreen}
            title="Çoklu Ekran Modu (1 / 2 / 4 Ekran)"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              multiScreenLayout > 1
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] hover:border-[var(--accent)]'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="hidden md:inline font-mono-nums">
              {multiScreenLayout === 1
                ? 'Çoklu Ekran'
                : `${multiScreenLayout}'li`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowUrlDialog(true)}
            aria-label="Kanallar ve Listeler"
            title="Kanallar ve Listeler"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] hover:border-[var(--accent)] text-xs font-semibold whitespace-nowrap"
          >
            <CloudDownload className="w-4 h-4 text-[var(--accent)]" />
            <span className="hidden sm:inline">Listeler</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsSidePanelOpen(true);
              setActiveTab((prev) => (prev === 'settings' ? 'channels' : 'settings'));
            }}
            aria-label="Ayarlar"
            title="Ayarlar"
            className={`p-2 rounded-lg transition-colors ${
              activeTab === 'settings' && isSidePanelOpen
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'text-[var(--accent)] hover:bg-white/10'
            }`}
          >
            <Settings className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowExitConfirm(true)}
            aria-label="Çıkış"
            title="Uygulamadan Çık"
            className="p-2 rounded-lg text-[var(--live)] hover:bg-white/10"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Non-intrusive Offline Banner */}
      {!isOnline && !isFullscreen && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-amber-500/15 border-b border-amber-500/40 text-amber-300 text-xs font-semibold">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>İnternet bağlantısı yok — önbellekteki kanal listeleri kullanılıyor.</span>
        </div>
      )}

      {/* EPG Program Reminder Alert Banner */}
      {activeReminderAlert && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 bg-[var(--surface-elevated)] border-b border-[var(--accent)] text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <BellRing className="w-4 h-4 text-[var(--accent)] shrink-0 animate-bounce" />
            <span className="text-[var(--ink)] truncate">
              <strong className="text-[var(--accent)]">Hatırlatıcı:</strong>{' '}
              {activeReminderAlert.channelName} — {activeReminderAlert.title}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                const match = allChannels.find(
                  (c) =>
                    c.id === activeReminderAlert.channelId ||
                    c.name === activeReminderAlert.channelName
                );
                if (match) handleSelectChannel(match);
                setActiveReminderAlert(null);
              }}
              className="px-2.5 py-1 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-[11px] font-bold"
            >
              İzle
            </button>
            <button
              type="button"
              onClick={() => setActiveReminderAlert(null)}
              className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--ink)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Responsive 3-Zone Workspace: Film & Dizi LEFT | Player CENTER | Kanallar & Radyo RIGHT */}
      <main className="flex-1 min-h-0 flex flex-col md:flex-row landscape:flex-row overflow-hidden">
        {/* Zone 1 (LEFT): Film & Dizi (VOD) on Landscape / Tablet / Desktop / TV */}
        <aside
          data-nav-zone="left-vod"
          aria-label="Film ve Dizi"
          className={
            isLeftVodOpen
              ? 'hidden md:flex landscape:flex md:w-[250px] landscape:w-[215px] lg:w-[300px] xl:w-[345px] shrink-0 flex-col bg-[var(--bg)] border-r border-[var(--border)] min-h-0'
              : 'hidden'
          }
        >
          <div className="shrink-0 px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[var(--accent)] truncate">
              <Film className="w-3.5 h-3.5 shrink-0" />
              <span>Film &amp; Dizi</span>
              <span className="font-mono-nums text-[10px] text-[var(--muted)]">
                ({safeVodItems.length + safeXtreamSeries.length})
              </span>
            </span>
            <button
              type="button"
              onClick={() => setIsLeftVodOpen(false)}
              aria-label="Sol Film & Dizi Panelini Kapat"
              title="Sol Film & Dizi Panelini Kapat"
              className="touch-compact p-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--live)] hover:border-[var(--live)]/60 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <VodSectionTab
            vodItems={safeVodItems}
            xtreamSeries={safeXtreamSeries}
            xtreamAuth={xtreamVodAuth}
            progressMap={vodProgressMap}
            favoriteIds={favoriteIds}
            currentChannel={currentChannel}
            isLoadingVod={isLoadingVod}
            isAiDiscoveringVod={isAiDiscoveringVod}
            onPlayVodItem={(item) => handleSelectChannel(vodItemToChannel(item))}
            onPlayEpisodeChannel={(epCh) => handleSelectChannel(epCh)}
            onToggleFavorite={toggleFavorite}
            onOpenImportModal={() => setShowVodModal(true)}
            onRefreshVodCatalog={() => loadVodCatalog(true)}
          />
        </aside>

        {/* Zone 2 (CENTER): Video / Multi-Screen Stage + Desktop EPG Now/Next Strip */}
        <section
          data-nav-zone="stage"
          className={`relative bg-black ${
            isSidePanelOpen
              ? 'shrink-0 w-full aspect-video max-h-[34dvh] md:w-auto md:aspect-auto md:max-h-none landscape:w-auto landscape:aspect-auto landscape:max-h-none md:flex-1 landscape:flex-1 md:flex landscape:flex md:flex-col landscape:flex-col md:min-w-0 landscape:min-w-0 md:min-h-0 landscape:min-h-0 md:border-r landscape:border-r md:border-[var(--border)] landscape:border-[var(--border)]'
              : 'flex-1 flex flex-col min-w-0 min-h-0'
          }`}
        >
          <div className="w-full h-full flex items-center justify-center min-h-0 bg-black flex-1">
            {multiScreenLayout === 2 || multiScreenLayout === 4 ? (
              <MultiScreenGrid
                layout={multiScreenLayout}
                slots={multiSlots}
                activeSlotIndex={activeSlotIndex}
                audioSlotIndex={audioSlotIndex}
                aspectMode={aspectMode}
                isFullscreen={isFullscreen}
                lowRamMode={settings.lowRamMode}
                acceleratedPlaybackMode={settings.acceleratedPlaybackMode}
                bufferPreset={settings.bufferPreset}
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
                menuAutoCloseSeconds={settings.menuAutoCloseSeconds}
                bufferPreset={settings.bufferPreset}
                controlsSize={settings.playerControlsSize}
                highContrastControls={settings.playerHighContrastControls}
                seekStepSeconds={settings.playerSeekStepSeconds}
                lowRamMode={settings.lowRamMode}
                acceleratedPlaybackMode={settings.acceleratedPlaybackMode}
                radioEffectMode={settings.radioEffectMode}
                radioEffectIntensity={settings.radioEffectIntensity}
                radioShowLogo={settings.radioShowLogoInStage}
                radioBackgroundImage={settings.radioBackgroundImage}
                epgMap={activeEpgMap}
                onChannelPerfEvent={handleChannelPerfEvent}
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
                onPlaybackStateChange={setIsVideoPlaying}
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
                isSidePanelOpen={isSidePanelOpen}
                onToggleSidePanel={() => setIsSidePanelOpen((v) => !v)}
                isLeftVodOpen={isLeftVodOpen}
                onToggleLeftVod={() => setIsLeftVodOpen((v) => !v)}
                onPrev={playPreviousChannel}
                onNext={playNextChannel}
              />
            )}
          </div>

          {!isLeftVodOpen && !isFullscreen && multiScreenLayout > 1 && (
            <button
              type="button"
              onClick={() => {
                setHeaderAutoHidden(false);
                setIsLeftVodOpen(true);
              }}
              className="hidden md:flex landscape:flex touch-compact absolute top-14 left-3 z-25 items-center gap-1.5 px-3 py-2 rounded-xl bg-black/80 border border-[var(--accent)] text-[var(--accent)] text-xs font-bold shadow-xl hover:bg-black"
            >
              <PanelLeftOpen className="w-4 h-4" />
              <span>Film &amp; Dizi</span>
            </button>
          )}

          {!isSidePanelOpen && !isFullscreen && multiScreenLayout > 1 && (
            <button
              type="button"
              onClick={() => {
                setHeaderAutoHidden(false);
                setIsSidePanelOpen(true);
              }}
              className="touch-compact absolute top-14 right-3 z-25 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/80 border border-[var(--accent)] text-[var(--accent)] text-xs font-bold shadow-xl hover:bg-black"
            >
              <PanelRightOpen className="w-4 h-4" />
              <span>Kanallar</span>
            </button>
          )}

          {/* Desktop/TV Below-Stage EPG Strip (shown only when active live EPG data exists) */}
          {currentChannel &&
            !currentChannel.isRadio &&
            multiScreenLayout === 1 &&
            isSidePanelOpen &&
            currentEpg?.now && (
              <div className="hidden lg:flex shrink-0 items-center justify-between gap-4 px-4 py-2 bg-[var(--surface-2)] border-t border-[var(--border)]">
                <div className="min-w-0 flex-1 flex items-center gap-3">
                  <span className="text-xs font-bold text-[var(--accent)] truncate">
                    {currentEpg.now.title}
                  </span>
                  <span className="font-mono-nums text-[11px] text-[var(--muted)] shrink-0">
                    {formatEpgTime(currentEpg.now.startMs)} –{' '}
                    {formatEpgTime(currentEpg.now.stopMs)}
                  </span>
                  <div className="w-24 h-1 rounded bg-[var(--bg)] overflow-hidden shrink-0">
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

                {settings.epgEnabled && (
                  <button
                    type="button"
                    onClick={() => setShowEpgDialog(true)}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)]"
                  >
                    <CalendarClock className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span>Yayın Akışı</span>
                  </button>
                )}
              </div>
            )}
        </section>

        {/* Zone 3 (RIGHT on Desktop/TV/Landscape, MAIN PANE on Mobile Portrait): Kanallar | Favoriler | Radyo | Ayarlar */}
        <section
          data-nav-zone="sidepanel"
          className={
            isSidePanelOpen
              ? 'flex-1 min-h-0 md:flex-none landscape:flex-none md:w-[315px] landscape:w-[270px] lg:w-[365px] xl:w-[410px] flex flex-col bg-[var(--bg)]'
              : 'hidden'
          }
        >
          {/* Always-Visible Top Quick Tabs: Kanallar | Favoriler | Radyo | Ayarlar (+ Close on Desktop/TV) */}
          <nav
            data-nav-zone="tabs"
            aria-label="Sağ Menü Sekmeleri"
            className="flex shrink-0 items-stretch gap-1 p-1.5 sm:p-2 bg-[var(--surface-2)] border-b border-[var(--border)]"
          >
            <button
              type="button"
              aria-current={activeTab === 'channels' || activeTab === 'vod' ? 'page' : undefined}
              onClick={() => setActiveTab('channels')}
              className={`touch-compact flex-1 min-w-0 flex flex-col lg:flex-row items-center justify-center gap-0.5 lg:gap-1.5 py-1.5 lg:py-2 px-1.5 rounded-xl text-[10px] sm:text-[11px] lg:text-xs font-bold transition-colors whitespace-nowrap ${
                activeTab === 'channels' || activeTab === 'vod'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-sm'
                  : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Tv className="w-3.5 h-3.5 shrink-0" />
              <span>Kanallar</span>
            </button>

            <button
              type="button"
              aria-current={activeTab === 'favorites' ? 'page' : undefined}
              onClick={() => setActiveTab('favorites')}
              title="Favorilere Hızlı Erişim"
              className={`touch-compact flex-1 min-w-0 flex flex-col lg:flex-row items-center justify-center gap-0.5 lg:gap-1.5 py-1.5 lg:py-2 px-1.5 rounded-xl text-[10px] sm:text-[11px] lg:text-xs font-bold transition-colors whitespace-nowrap ${
                activeTab === 'favorites'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-sm'
                  : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] hover:border-[var(--accent)]/60'
              }`}
            >
              <Heart
                className={`w-3.5 h-3.5 shrink-0 ${
                  activeTab === 'favorites'
                    ? 'fill-current'
                    : favoriteChannels.length > 0
                    ? 'fill-[var(--live)] text-[var(--live)]'
                    : 'text-[var(--live)]'
                }`}
              />
              <span>
                Favoriler
                {favoriteChannels.length > 0 && (
                  <span className="font-mono-nums opacity-80 ml-1">
                    ({favoriteChannels.length})
                  </span>
                )}
              </span>
            </button>

            <button
              type="button"
              aria-current={activeTab === 'radio' ? 'page' : undefined}
              onClick={() => setActiveTab('radio')}
              className={`touch-compact flex-1 min-w-0 flex flex-col lg:flex-row items-center justify-center gap-0.5 lg:gap-1.5 py-1.5 lg:py-2 px-1.5 rounded-xl text-[10px] sm:text-[11px] lg:text-xs font-bold transition-colors whitespace-nowrap ${
                activeTab === 'radio'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-sm'
                  : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Radio className="w-3.5 h-3.5 shrink-0" />
              <span>Radyo</span>
            </button>

            <button
              type="button"
              aria-current={activeTab === 'settings' ? 'page' : undefined}
              onClick={() => setActiveTab('settings')}
              className={`touch-compact flex-1 min-w-0 flex flex-col lg:flex-row items-center justify-center gap-0.5 lg:gap-1.5 py-1.5 lg:py-2 px-1.5 rounded-xl text-[10px] sm:text-[11px] lg:text-xs font-bold transition-colors whitespace-nowrap ${
                activeTab === 'settings'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-sm'
                  : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Settings className="w-3.5 h-3.5 shrink-0" />
              <span>Ayarlar</span>
            </button>

            <button
              type="button"
              onClick={() => setIsSidePanelOpen(false)}
              aria-label="Listeyi Kapat"
              title="Sağ Menüyü Kapat (Tam Genişlik İzle)"
              className="hidden md:inline-flex landscape:inline-flex items-center justify-center touch-compact shrink-0 px-2 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--live)] hover:border-[var(--live)]/60 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
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

          {/* TAB 1: Kanallar (also active in Right Panel on md+/landscape when activeTab==='vod') */}
          {(activeTab === 'channels' || activeTab === 'vod') && (
            <div
              className={
                activeTab === 'vod'
                  ? 'hidden md:flex landscape:flex flex-1 min-h-0 flex-col'
                  : 'flex-1 min-h-0 flex flex-col'
              }
            >
              <div className="shrink-0 px-3 pt-2.5 pb-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-[var(--accent)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    data-channel-search="true"
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
                      className="touch-compact absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--muted)] hover:text-[var(--ink)]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Clean Single-Row Category Filter Bar (Adult filter, smart sorting & grouping run automatically) */}
              <div
                data-nav-zone="smart-groups"
                className="shrink-0 px-3 pb-2 flex items-center gap-1.5 overflow-x-auto touch-scroll-x"
              >
                {visibleCategories.map((category) => {
                  const isAll = category === 'Tümü';
                  const selected = isAll
                    ? activeSmartGroups.length === 0 && selectedCategory === 'Tümü'
                    : activeSmartGroups.length > 0
                    ? activeSmartGroups.includes(category)
                    : selectedCategory === category;
                  const count = categoryCounts.get(category) ?? 0;
                  return (
                    <button
                      key={category}
                      type="button"
                      data-focus-inset="true"
                      onClick={() => toggleSmartGroupFilter(category)}
                      className={`touch-compact shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors whitespace-nowrap ${
                        selected
                          ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                          : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]'
                      }`}
                    >
                      {selected && !isAll && <Check className="w-3 h-3 shrink-0" />}
                      <span>{category}</span>
                      <span className="font-mono-nums text-[10px] opacity-75">
                        {count}
                      </span>
                    </button>
                  );
                })}
                {(activeSmartGroups.length > 0 || selectedCategory !== 'Tümü') && (
                  <button
                    type="button"
                    onClick={() => {
                      updateSettings({ smartGroupFilters: [] });
                      setSelectedCategory('Tümü');
                    }}
                    className="touch-compact shrink-0 px-2 py-1.5 rounded-lg text-[11px] font-bold text-[var(--live)] hover:bg-white/5 whitespace-nowrap"
                  >
                    Sıfırla
                  </button>
                )}
              </div>

              {isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="w-9 h-9 rounded-full border-3 border-[var(--accent)]/25 border-t-[var(--accent)] animate-spin" />
                </div>
              ) : (
                <div
                  data-nav-zone="list"
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
                  className="flex-1 min-h-0 overflow-y-auto touch-scroll-y px-3 py-1 space-y-2 pb-4"
                >
                  {filteredChannels.slice(0, visibleCount).map((channel, idx, arr) => {
                    const prevChannel = idx > 0 ? arr[idx - 1] : null;
                    const showDivider =
                      showGroupHeaders &&
                      (!prevChannel ||
                        prevChannel.smartCategory !== channel.smartCategory);
                    const totalInGroup =
                      groupTotals.get(channel.smartCategory) ?? 0;

                    return (
                      <div key={channel.id} className="space-y-1.5">
                        {showDivider && (
                          <div className="sticky top-0 z-10 flex items-center justify-between px-2.5 py-1 rounded-lg bg-[var(--surface-2)]/95 backdrop-blur-xs border border-[var(--border)] text-[10px] font-extrabold uppercase tracking-wider text-[var(--accent)]">
                            <span className="flex items-center gap-1.5 truncate">
                              <CategoryIcon
                                category={channel.smartCategory as CategoryName}
                                selected={false}
                                className="w-3 h-3 shrink-0"
                              />
                              <span className="truncate">{channel.smartCategory}</span>
                            </span>
                            <span className="font-mono-nums text-[var(--muted)] shrink-0">
                              {totalInGroup} kanal
                            </span>
                          </div>
                        )}
                        <ChannelRowItem
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
                      </div>
                    );
                  })}

                  {filteredChannels.length === 0 && (
                    <div className="py-12 text-center text-sm text-[var(--muted)] space-y-3">
                      <div>Aramanızla veya seçili tür filtresiyle eşleşen kanal bulunamadı.</div>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedCategory('Tümü');
                          updateSettings({ smartGroupFilters: [] });
                        }}
                        className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)]"
                      >
                        Tüm Kanalları Göster
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 1.5: Always-Visible Quick Favoriler & Son İzlenenler Tab */}
          {activeTab === 'favorites' && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="shrink-0 px-3 pt-2.5 pb-2 space-y-2">
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setFavSubView('favorites')}
                    className={`touch-compact flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors ${
                      favSubView === 'favorites'
                        ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                        : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${
                        favSubView === 'favorites'
                          ? 'fill-current'
                          : 'fill-[var(--live)] text-[var(--live)]'
                      }`}
                    />
                    <span>Favoriler ({favoriteChannels.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFavSubView('recent')}
                    className={`touch-compact flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors ${
                      favSubView === 'recent'
                        ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                        : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>Son İzlenenler ({recentChannels.length})</span>
                  </button>
                </div>

                {favSubView === 'favorites' && favoriteIds.size > 0 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={clearFavorites}
                      className="touch-compact px-2 py-0.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[10px] font-bold text-[var(--live)] hover:border-[var(--live)]/60"
                    >
                      Favorileri Temizle
                    </button>
                  </div>
                )}
              </div>

              <div className="shrink-0 px-3 pb-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-[var(--accent)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    data-channel-search="true"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      favSubView === 'recent'
                        ? 'Son izlenenlerde ara...'
                        : 'Favorilerde kanal, film veya radyo ara...'
                    }
                    className="w-full rounded-xl bg-[var(--surface)] border border-[var(--border)] pl-10 pr-9 py-2.5 text-[13px] text-[var(--ink)] placeholder-[var(--muted)]/60 focus:outline-none focus:border-[var(--accent)]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Temizle"
                      onClick={() => setSearchQuery('')}
                      className="touch-compact absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--muted)] hover:text-[var(--ink)]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div
                data-nav-zone="list"
                className="flex-1 min-h-0 overflow-y-auto touch-scroll-y px-3 py-1 space-y-2 pb-4"
              >
                {(favSubView === 'recent' ? recentChannels : favoriteChannels).map((channel) => (
                  <ChannelRowItem
                    key={`${favSubView}_${channel.id}`}
                    channel={channel}
                    epgNow={
                      channel.isRadio
                        ? null
                        : lookupEpgForChannel(activeEpgMap, channel.name)?.now?.title ??
                          null
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

                {(favSubView === 'recent' ? recentChannels : favoriteChannels).length === 0 && (
                  <div className="py-12 px-4 text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mx-auto">
                      {favSubView === 'recent' ? (
                        <History className="w-6 h-6 text-[var(--muted)]" />
                      ) : (
                        <Heart className="w-6 h-6 text-[var(--muted)]" />
                      )}
                    </div>
                    <div className="text-sm font-bold text-[var(--ink)]">
                      {searchQuery
                        ? 'Aramanızla eşleşen kayıt bulunamadı.'
                        : favSubView === 'recent'
                        ? 'Henüz izlenen kanal geçmişi yok.'
                        : 'Henüz favori kanalınız yok.'}
                    </div>
                    <p className="text-xs text-[var(--muted)] max-w-xs mx-auto leading-relaxed">
                      {favSubView === 'recent'
                        ? 'Herhangi bir TV kanalı, film veya radyo açtığınızda son izlenenler burada listelenir.'
                        : 'İzlediğiniz TV kanalı, film veya radyonun yanındaki kalp (♥) simgesine basarak buraya anında ekleyebilirsiniz.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setActiveTab('channels');
                      }}
                      className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)]"
                    >
                      Kanallara Göz At
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2 (Mobile Portrait Only): Film & Dizi */}
          {activeTab === 'vod' && (
            <div
              data-nav-zone="panel"
              className="md:hidden landscape:hidden flex-1 min-h-0 flex flex-col"
            >
              <VodSectionTab
                vodItems={safeVodItems}
                xtreamSeries={safeXtreamSeries}
                xtreamAuth={xtreamVodAuth}
                progressMap={vodProgressMap}
                favoriteIds={favoriteIds}
                currentChannel={currentChannel}
                isLoadingVod={isLoadingVod}
                isAiDiscoveringVod={isAiDiscoveringVod}
                onPlayVodItem={(item) => handleSelectChannel(vodItemToChannel(item))}
                onPlayEpisodeChannel={(epCh) => handleSelectChannel(epCh)}
                onToggleFavorite={toggleFavorite}
                onOpenImportModal={() => setShowVodModal(true)}
                onRefreshVodCatalog={() => loadVodCatalog(true)}
              />
            </div>
          )}

          {/* TAB 3: Online Radyo */}
          {activeTab === 'radio' && (
            <div data-nav-zone="panel" className="flex-1 min-h-0 flex flex-col">
              <OnlineRadioTab
                radios={safeOnlineRadios}
                kurdishRadios={safeKurdishRadios}
                globalRadios={safeGlobalRadios}
                isLoading={isLoadingRadios}
                currentChannel={currentChannel}
                favoriteIds={favoriteIds}
                perfMap={perfMap}
                onSelectChannel={handleSelectChannel}
                onToggleFavorite={toggleFavorite}
                onRefresh={(scope) => void loadOnlineRadios(scope, true)}
              />
            </div>
          )}

          {/* TAB 4: Ayarlar */}
          {activeTab === 'settings' && (
            <div data-nav-zone="panel" className="flex-1 min-h-0 flex flex-col">
              <SettingsTab
                settings={settings}
                savedUrl={savedUrl}
                mandatoryAutoUpdate={mandatoryAutoUpdate}
                lastUpdatedAt={lastUpdatedAt}
                externalSources={externalSources}
                isSyncingExternal={isSyncingExternal}
                isAiDiscovering={isAiDiscovering}
                sleepMinutes={sleepMinutes}
                isUpdating={isUpdating}
                isLoadingEpg={isLoadingEpg}
                epgChannelCount={epgChannelCount}
                favoriteCount={favoriteIds.size}
                totalChannelsCount={allChannels.length}
                onlineRadiosCount={safeOnlineRadios.length + safeKurdishRadios.length}
                blockedAdultCount={blockedAdultCount}
                trackedPerfCount={Object.keys(perfMap).length}
                channelsWithLogoCount={channelsWithLogoCount}
                isResolvingLogos={isResolvingLogos}
                onUpdateSettings={updateSettings}
                onSaveAndUpdateUrl={handleSaveAndUpdate}
                onAddBulkExternalSources={handleAddBulkExternalSources}
                onAiDiscoverLists={(topic) => discoverAndAddGithubListsWithAi(topic, false)}
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
                onResetPerformanceStats={handleResetPerformanceStats}
                onAutoFindLogos={() => void handleAutoFindAllLogos()}
              />
            </div>
          )}
        </section>
      </main>

      {/* Mobile Portrait Bottom Thumb Navigation Bar (hidden on md+ / landscape / fullscreen) */}
      {!isFullscreen && (
        <nav
          aria-label="Mobil Alt Menü"
          className="md:hidden landscape:hidden shrink-0 grid grid-cols-5 bg-[var(--surface-2)]/95 backdrop-blur-md border-t border-[var(--border)] pb-[env(safe-area-inset-bottom,0px)]"
        >
          {(
            [
              { id: 'vod', label: 'Film/Dizi', icon: Film },
              { id: 'channels', label: 'Kanallar', icon: Tv },
              { id: 'favorites', label: 'Favoriler', icon: Heart },
              { id: 'radio', label: 'Radyo', icon: Radio },
              { id: 'settings', label: 'Ayarlar', icon: Settings },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = isSidePanelOpen && activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  setIsSidePanelOpen(true);
                  setActiveTab(item.id);
                }}
                className={`relative min-h-[52px] flex flex-col items-center justify-center gap-0.5 py-1.5 px-1 text-[10px] font-bold transition-colors touch-manipulation ${
                  active
                    ? 'text-[var(--accent)] bg-[var(--surface-elevated)]/60'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                <div className="relative">
                  <Icon
                    className={`w-5 h-5 shrink-0 ${
                      item.id === 'favorites' && (active || favoriteChannels.length > 0)
                        ? active
                          ? 'fill-current'
                          : 'fill-[var(--live)] text-[var(--live)]'
                        : ''
                    }`}
                  />
                  {item.id === 'favorites' && favoriteChannels.length > 0 && (
                    <span className="font-mono-nums absolute -top-1.5 -right-2.5 px-1 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] text-[9px] leading-tight font-extrabold">
                      {favoriteChannels.length}
                    </span>
                  )}
                </div>
                <span className="truncate whitespace-nowrap max-w-full">{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Lazy-loaded Modals for Faster Startup & Lower RAM */}
      <Suspense fallback={null}>
        {showUrlDialog && (
          <PlaylistUpdateModal
            isOpen={showUrlDialog}
            savedUrl={savedUrl}
            mandatoryAutoUpdate={mandatoryAutoUpdate}
            lastUpdatedAt={lastUpdatedAt}
            menuAutoCloseSeconds={settings.menuAutoCloseSeconds}
            onClose={() => setShowUrlDialog(false)}
            onSaveAndUpdate={handleSaveAndUpdate}
            onAddBulkSources={handleAddBulkExternalSources}
            onAiDiscoverLists={(topic) => discoverAndAddGithubListsWithAi(topic, false)}
            onImportLocalM3u={handleImportLocalM3u}
            onImportXtream={handleImportXtream}
            onResetDefault={handleResetDefault}
          />
        )}

        {showVodModal && (
          <VodImportModal
            isOpen={showVodModal}
            savedVodUrl={savedVodUrl}
            hasVodItems={vodItems.length > 0 || xtreamSeries.length > 0}
            menuAutoCloseSeconds={settings.menuAutoCloseSeconds}
            onClose={() => setShowVodModal(false)}
            onImportVodUrl={async (url) => {
              const normalized = normalizeInputUrl(url);
              const res = await fetch(
                `/api/playlist/import?url=${encodeURIComponent(normalized)}&_t=${Date.now()}`,
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
              const added = mergeVodM3uContent(data.content);
              setSavedVodUrl(normalized);
              try {
                localStorage.setItem(STORAGE_VOD_URL_KEY, normalized);
              } catch {
                // ignore
              }
              const catCount = new Set(parsed.map((p) => p.autoCategory)).size;
              setStatusMessage(
                added > 0
                  ? `${added} film/dizi eklendi (${catCount} kategori).`
                  : `Liste tarandı (${parsed.length} içerik zaten katalogda mevcut).`
              );
            }}
            onImportVodFile={(content, filename) => {
              const trimmed = content.trimStart();
              let m3uPayload = content;
              if (
                filename.toLowerCase().endsWith('.json') ||
                trimmed.startsWith('{') ||
                trimmed.startsWith('[')
              ) {
                const jsonChannels = parseUniversalPlaylist(content, filename);
                if (jsonChannels.length === 0) {
                  setStatusMessage(`${filename} içinde geçerli film/dizi bulunamadı.`);
                  return;
                }
                const lines = ['#EXTM3U'];
                for (const c of jsonChannels) {
                  const logoAttr = c.logoUrl ? ` tvg-logo="${c.logoUrl.replace(/"/g, '')}"` : '';
                  const grp = (c.originalGroup || c.smartCategory || 'Genel Filmler').replace(/"/g, '');
                  lines.push(
                    `#EXTINF:-1 tvg-name="${c.name.replace(/"/g, '')}"${logoAttr} group-title="${grp}",${c.name}`
                  );
                  lines.push(c.streamUrl);
                }
                m3uPayload = lines.join('\n');
              }
              const parsed = parseVodM3u(m3uPayload);
              if (parsed.length === 0) {
                setStatusMessage(`${filename} içinde geçerli film/dizi bulunamadı.`);
                return;
              }
              const added = mergeVodM3uContent(m3uPayload);
              const catCount = new Set(parsed.map((p) => p.autoCategory)).size;
              setStatusMessage(
                added > 0
                  ? `${filename}: ${added} film/dizi ve ${catCount} kategori eklendi.`
                  : `${filename}: ${parsed.length} içerik zaten listede mevcut.`
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
        )}

        {showSleepDialog && (
          <SleepTimerModal
            isOpen={showSleepDialog}
            menuAutoCloseSeconds={settings.menuAutoCloseSeconds}
            onClose={() => setShowSleepDialog(false)}
            onSelectMinutes={handleSetSleepTimer}
          />
        )}

        {showEpgDialog && (
          <EpgScheduleModal
            isOpen={showEpgDialog}
            channel={currentChannel}
            epgUrl={settings.epgUrl}
            menuAutoCloseSeconds={settings.menuAutoCloseSeconds}
            reminders={epgReminders}
            onToggleReminder={toggleEpgReminder}
            onClose={() => setShowEpgDialog(false)}
          />
        )}
      </Suspense>

      <ExitConfirmModal
        isOpen={showExitConfirm}
        menuAutoCloseSeconds={settings.menuAutoCloseSeconds}
        onConfirmExit={handleConfirmExit}
        onCancel={() => setShowExitConfirm(false)}
      />
    </div>
  );
}
