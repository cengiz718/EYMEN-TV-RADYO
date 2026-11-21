export interface Channel {
  id: string;
  name: string;
  streamUrl: string;
  logoUrl: string | null;
  originalGroup: string;
  smartCategory: string;
  isRadio: boolean;
  isVod?: boolean;
  userAgent: string;
  referer: string;
  origin: string;
  codec?: string;
  bitrate?: number;
  tags?: string;
  source?: 'm3u' | 'online-radio' | 'xtream' | 'vod' | 'github-json' | 'external';
}

export interface ExternalListSource {
  id: string;
  name: string;
  url: string;
  format: 'auto' | 'm3u' | 'json';
  enabled: boolean;
  autoSync: boolean;
  channelCount?: number;
  lastUpdatedAt?: string | null;
  lastError?: string | null;
  isBuiltinPreset?: boolean;
}

export const DEFAULT_EXTERNAL_SOURCES: ExternalListSource[] = [
  {
    id: 'builtin_github_spor',
    name: 'GitHub · Açık Kaynak Spor Listesi',
    url: 'https://iptv-org.github.io/iptv/categories/sports.m3u',
    format: 'm3u',
    enabled: true,
    autoSync: true,
    isBuiltinPreset: true,
  },
  {
    id: 'builtin_github_tr',
    name: 'GitHub · Türkiye Ek Canlı Liste',
    url: 'https://iptv-org.github.io/iptv/countries/tr.m3u',
    format: 'm3u',
    enabled: true,
    autoSync: true,
    isBuiltinPreset: true,
  },
];

export interface VodItem {
  id: string;
  name: string;
  streamUrl: string;
  posterUrl: string | null;
  type: 'movie' | 'series';
  autoCategory: string;
  originalGroup: string;
  year?: string;
  seasonEpisode?: string;
  seriesTitle?: string;
  userAgent: string;
  referer: string;
  origin: string;
}

export interface XtreamSeriesEntry {
  seriesId: string;
  name: string;
  posterUrl: string | null;
  category: string;
  rating?: string;
  year?: string;
}

export interface XtreamVodAuth {
  server: string;
  username: string;
  password: string;
}

export interface VodProgressEntry {
  currentTime: number;
  duration: number;
  updatedAt: number;
}

export const CATEGORIES = [
  'Tümü',
  'Favoriler',
  'Haber & Ulusal',
  'Spor',
  'Radyo & Müzik',
  'Sinema & Dizi',
  'Belgesel & Doğa',
  'Çocuk & Eğitim',
  'Yerel & Diğer',
] as const;

export type CategoryName = (typeof CATEGORIES)[number];

export const HIDEABLE_CATEGORIES: CategoryName[] = CATEGORIES.filter(
  (c) => c !== 'Tümü' && c !== 'Favoriler'
);

export type AspectMode = 'fit' | 'fill' | 'zoom';

export type ActiveTab = 'channels' | 'vod' | 'radio' | 'settings';

export type AppTheme = 'modern' | 'klasik' | 'sinema';

export type MultiScreenLayout = 1 | 2 | 4;

export type PlayerControlsSize = 'normal' | 'large' | 'xlarge';

export type RadioEffectMode = 'aurora' | 'equalizer' | 'pulse' | 'cosmic' | 'off';

export type RadioEffectIntensity = 'calm' | 'medium' | 'vivid';

export interface EpgProgrammeItem {
  title: string;
  startMs: number;
  stopMs: number;
  desc?: string;
}

export interface EpgNowNext {
  now: EpgProgrammeItem | null;
  next: { title: string; startMs: number; stopMs: number } | null;
}

export interface AppSettings {
  theme: AppTheme;
  autoPlayOnLaunch: boolean;
  resumeLastChannel: boolean;
  defaultAspectMode: AspectMode;
  autoRefreshMinutes: number; // 0 = off, 15, 30, 60
  mergeOnlineRadiosToChannels: boolean;
  autoSyncExternalLists: boolean;
  hudHideSeconds: number;
  epgEnabled: boolean;
  epgUrl: string;
  hiddenCategories: CategoryName[];
  playerControlsSize: PlayerControlsSize;
  playerHighContrastControls: boolean;
  playerSeekStepSeconds: number;
  radioEffectMode: RadioEffectMode;
  radioEffectIntensity: RadioEffectIntensity;
  radioShowLogoInStage: boolean;
  radioBackgroundImage: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'modern',
  autoPlayOnLaunch: true,
  resumeLastChannel: true,
  defaultAspectMode: 'fit',
  autoRefreshMinutes: 30,
  mergeOnlineRadiosToChannels: true,
  autoSyncExternalLists: true,
  hudHideSeconds: 4,
  epgEnabled: true,
  epgUrl: '',
  hiddenCategories: [],
  playerControlsSize: 'large',
  playerHighContrastControls: true,
  playerSeekStepSeconds: 15,
  radioEffectMode: 'aurora',
  radioEffectIntensity: 'vivid',
  radioShowLogoInStage: true,
  radioBackgroundImage: '',
};
