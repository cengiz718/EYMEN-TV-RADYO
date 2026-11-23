import type { Channel } from '../types/channel';

const LOGO_CACHE_KEY = 'eymen_auto_logos_v1';
const MAX_CACHED_LOGOS = 2500;

export function isDeadLogoUrl(url?: string | null): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'logo.huhu.to' ||
      host.endsWith('.huhu.to') ||
      host.includes('wikia.nocookie.net')
    );
  } catch {
    return true;
  }
}

export function loadAutoLogoCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LOGO_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveAutoLogoCache(map: Record<string, string>): void {
  try {
    const entries = Object.entries(map).slice(-MAX_CACHED_LOGOS);
    localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Ignore storage quota errors
  }
}

export function applyCachedLogosToChannels(
  channels: Channel[],
  cache: Record<string, string> = loadAutoLogoCache()
): Channel[] {
  if (channels.length === 0) return channels;
  let changed = false;
  const next = channels.map((ch) => {
    const currentBroken = isDeadLogoUrl(ch.logoUrl);
    if (!currentBroken) return ch;
    const cached = cache[ch.name];
    if (cached && !isDeadLogoUrl(cached)) {
      changed = true;
      return { ...ch, logoUrl: cached };
    }
    if (ch.logoUrl && currentBroken) {
      changed = true;
      return { ...ch, logoUrl: null };
    }
    return ch;
  });
  return changed ? next : channels;
}

export async function resolveAndAttachChannelLogos(
  channels: Channel[],
  forceRescan = false
): Promise<{
  updated: Channel[];
  newlyMatched: number;
  totalWithLogos: number;
}> {
  if (channels.length === 0) {
    return { updated: channels, newlyMatched: 0, totalWithLogos: 0 };
  }

  const cache = loadAutoLogoCache();
  const withCache = applyCachedLogosToChannels(channels, cache);

  // Deduplicate channel names needing resolution
  const missingByName = new Map<string, { name: string; isRadio: boolean; currentLogo: string | null }>();
  for (const ch of withCache) {
    const needsLogo = forceRescan ? isDeadLogoUrl(ch.logoUrl) : isDeadLogoUrl(ch.logoUrl);
    if (!needsLogo) continue;
    if (!missingByName.has(ch.name)) {
      missingByName.set(ch.name, {
        name: ch.name,
        isRadio: Boolean(ch.isRadio),
        currentLogo: null,
      });
    }
  }

  if (missingByName.size === 0) {
    const totalWithLogos = withCache.filter((c) => !isDeadLogoUrl(c.logoUrl)).length;
    return { updated: withCache, newlyMatched: 0, totalWithLogos };
  }

  const items = [...missingByName.values()];
  const resolvedLogos: Record<string, string> = {};

  // Send in chunks of 1200 to stay well within request payload bounds
  for (let i = 0; i < items.length; i += 1200) {
    const chunk = items.slice(i, i + 1200);
    try {
      const res = await fetch('/api/logos/resolve-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: chunk }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { logos?: Record<string, string> };
      if (data.logos) {
        Object.assign(resolvedLogos, data.logos);
      }
    } catch {
      // Keep partial results if offline/transient error
    }
  }

  let newlyMatched = 0;
  for (const [name, url] of Object.entries(resolvedLogos)) {
    if (url && !isDeadLogoUrl(url)) {
      cache[name] = url;
      newlyMatched++;
    }
  }
  if (newlyMatched > 0) {
    saveAutoLogoCache(cache);
  }

  const updated = withCache.map((ch) => {
    const found = resolvedLogos[ch.name];
    if (found && isDeadLogoUrl(ch.logoUrl)) {
      return { ...ch, logoUrl: found };
    }
    return ch;
  });

  const totalWithLogos = updated.filter((c) => !isDeadLogoUrl(c.logoUrl)).length;
  return { updated, newlyMatched, totalWithLogos };
}

export function buildChannelLogoProxyUrl(channel: {
  name: string;
  logoUrl?: string | null;
  isRadio?: boolean;
}): string | null {
  const nameParam = `name=${encodeURIComponent(channel.name)}${
    channel.isRadio ? '&radio=1' : ''
  }`;
  if (channel.logoUrl && !isDeadLogoUrl(channel.logoUrl)) {
    return `/api/logo?url=${encodeURIComponent(channel.logoUrl)}&${nameParam}`;
  }
  return null;
}
