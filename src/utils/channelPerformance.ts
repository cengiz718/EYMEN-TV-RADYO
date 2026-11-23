import type { Channel } from '../types/channel';

export const STORAGE_CHANNEL_PERF_KEY = 'eymen_channel_perf_v1';
const MAX_STORED_PERF_ENTRIES = 450;

export type ChannelPerfTier = 'fast' | 'stable' | 'slow' | 'unstable' | 'untested';

export interface ChannelPerfStats {
  key: string;
  name: string;
  attempts: number;
  successes: number;
  avgStartupMs: number | null;
  lastStartupMs: number | null;
  stallCount: number;
  errorCount: number;
  score: number;
  tier: ChannelPerfTier;
  lastTestedAt: number;
}

export type ChannelPerfEvent =
  | { type: 'load_start' }
  | { type: 'playing'; startupMs?: number }
  | { type: 'stall' }
  | { type: 'error' };

export function getChannelPerfKey(channel: Pick<Channel, 'streamUrl' | 'name'>): string {
  const url = (channel.streamUrl || '').trim();
  if (url) return url;
  return `name:${channel.name.trim().toLocaleLowerCase('tr-TR')}`;
}

export function computeChannelScore(
  stats: Pick<
    ChannelPerfStats,
    'attempts' | 'successes' | 'avgStartupMs' | 'stallCount' | 'errorCount'
  >
): { score: number; tier: ChannelPerfTier } {
  if (stats.attempts === 0 && stats.successes === 0) {
    return { score: 0, tier: 'untested' };
  }

  let score = 78;

  if (stats.avgStartupMs !== null) {
    if (stats.avgStartupMs <= 900) score += 18;
    else if (stats.avgStartupMs <= 1800) score += 12;
    else if (stats.avgStartupMs <= 3200) score += 5;
    else if (stats.avgStartupMs <= 5500) score -= 5;
    else score -= 14;
  }

  const totalAttempts = Math.max(1, stats.attempts);
  const successRate = stats.successes / totalAttempts;
  score += Math.round((successRate - 0.5) * 20);

  const stallsPerPlay = stats.stallCount / Math.max(1, stats.successes);
  score -= Math.min(28, Math.round(stallsPerPlay * 9));

  const effectiveErrors =
    stats.successes > stats.errorCount * 2
      ? stats.errorCount * 0.65
      : stats.errorCount;
  score -= Math.min(48, Math.round(effectiveErrors * 18));

  const clamped = Math.max(5, Math.min(100, Math.round(score)));

  let tier: ChannelPerfTier;
  if (clamped >= 84 && (stats.avgStartupMs ?? 9999) <= 2200) {
    tier = 'fast';
  } else if (clamped >= 64) {
    tier = 'stable';
  } else if (clamped >= 44) {
    tier = 'slow';
  } else {
    tier = 'unstable';
  }

  return { score: clamped, tier };
}

export function loadChannelPerfMap(): Record<string, ChannelPerfStats> {
  try {
    const raw = localStorage.getItem(STORAGE_CHANNEL_PERF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ChannelPerfStats>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveChannelPerfMap(map: Record<string, ChannelPerfStats>): void {
  try {
    const entries = Object.entries(map);
    let toSave = map;
    if (entries.length > MAX_STORED_PERF_ENTRIES) {
      entries.sort((a, b) => (b[1].lastTestedAt || 0) - (a[1].lastTestedAt || 0));
      toSave = Object.fromEntries(entries.slice(0, MAX_STORED_PERF_ENTRIES));
    }
    localStorage.setItem(STORAGE_CHANNEL_PERF_KEY, JSON.stringify(toSave));
  } catch {
    // ignore storage quota errors
  }
}

export function clearChannelPerfMap(): void {
  try {
    localStorage.removeItem(STORAGE_CHANNEL_PERF_KEY);
  } catch {
    // ignore
  }
}

export function recordChannelPerfEvent(
  prevMap: Record<string, ChannelPerfStats>,
  channel: Pick<Channel, 'streamUrl' | 'name'>,
  event: ChannelPerfEvent
): Record<string, ChannelPerfStats> {
  const key = getChannelPerfKey(channel);
  const existing = prevMap[key] ?? {
    key,
    name: channel.name,
    attempts: 0,
    successes: 0,
    avgStartupMs: null,
    lastStartupMs: null,
    stallCount: 0,
    errorCount: 0,
    score: 0,
    tier: 'untested' as ChannelPerfTier,
    lastTestedAt: Date.now(),
  };

  const next: ChannelPerfStats = {
    ...existing,
    name: channel.name,
    lastTestedAt: Date.now(),
  };

  if (event.type === 'load_start') {
    next.attempts += 1;
  } else if (event.type === 'playing') {
    next.attempts = Math.max(next.attempts, 1);
    next.successes += 1;
    if (typeof event.startupMs === 'number' && Number.isFinite(event.startupMs)) {
      const clampedMs = Math.max(50, Math.min(30000, Math.round(event.startupMs)));
      next.lastStartupMs = clampedMs;
      next.avgStartupMs =
        next.avgStartupMs === null
          ? clampedMs
          : Math.round(next.avgStartupMs * 0.6 + clampedMs * 0.4);
    }
  } else if (event.type === 'stall') {
    next.stallCount += 1;
  } else if (event.type === 'error') {
    next.attempts = Math.max(next.attempts, 1);
    next.errorCount += 1;
  }

  const computed = computeChannelScore(next);
  next.score = computed.score;
  next.tier = computed.tier;

  return {
    ...prevMap,
    [key]: next,
  };
}

export interface ChannelPerfDisplay {
  label: string;
  startupText: string | null;
  scoreText: string;
  tone: 'fast' | 'stable' | 'warn' | 'bad';
}

export function getChannelPerfDisplay(
  stats: ChannelPerfStats | null | undefined
): ChannelPerfDisplay | null {
  if (!stats || stats.tier === 'untested' || (stats.attempts === 0 && stats.successes === 0)) {
    return null;
  }

  const startupText =
    stats.avgStartupMs !== null
      ? `${(stats.avgStartupMs / 1000).toFixed(1)}sn`
      : null;

  if (stats.tier === 'fast') {
    return {
      label: 'Çok Hızlı',
      startupText,
      scoreText: `%${stats.score}`,
      tone: 'fast',
    };
  }
  if (stats.tier === 'stable') {
    return {
      label: 'Stabil',
      startupText,
      scoreText: `%${stats.score}`,
      tone: 'stable',
    };
  }
  if (stats.tier === 'slow') {
    return {
      label: 'Yavaş',
      startupText,
      scoreText: `%${stats.score}`,
      tone: 'warn',
    };
  }
  return {
    label: 'Kararsız',
    startupText,
    scoreText: `%${stats.score}`,
    tone: 'bad',
  };
}

export function sortChannelsByPerformance(
  channels: Channel[],
  perfMap: Record<string, ChannelPerfStats>
): Channel[] {
  if (channels.length <= 1) return channels;

  const reliable: Array<{ ch: Channel; stats: ChannelPerfStats; idx: number }> = [];
  const untested: Channel[] = [];
  const unstable: Array<{ ch: Channel; stats: ChannelPerfStats; idx: number }> = [];

  channels.forEach((ch, idx) => {
    const stats = perfMap[getChannelPerfKey(ch)];
    if (!stats || stats.tier === 'untested' || (stats.successes === 0 && stats.errorCount === 0)) {
      untested.push(ch);
      return;
    }
    if (stats.score >= 52 && stats.successes > 0) {
      reliable.push({ ch, stats, idx });
    } else {
      unstable.push({ ch, stats, idx });
    }
  });

  if (reliable.length === 0 && unstable.length === 0) {
    return channels;
  }

  reliable.sort((a, b) => {
    if (b.stats.score !== a.stats.score) return b.stats.score - a.stats.score;
    const msA = a.stats.avgStartupMs ?? 99999;
    const msB = b.stats.avgStartupMs ?? 99999;
    if (msA !== msB) return msA - msB;
    return a.idx - b.idx;
  });

  unstable.sort((a, b) => {
    if (b.stats.score !== a.stats.score) return b.stats.score - a.stats.score;
    return a.idx - b.idx;
  });

  return [
    ...reliable.map((x) => x.ch),
    ...untested,
    ...unstable.map((x) => x.ch),
  ];
}
