import { useMemo, useState } from 'react';
import { Globe, Radio, RefreshCw, Search, X } from 'lucide-react';
import type { Channel } from '../types/channel';
import {
  sortChannelsByPerformance,
  type ChannelPerfStats,
} from '../utils/channelPerformance';
import { ChannelRowItem } from './ChannelRowItem';

interface OnlineRadioTabProps {
  radios: Channel[];
  kurdishRadios: Channel[];
  globalRadios: Channel[];
  isLoading: boolean;
  currentChannel: Channel | null;
  favoriteIds: Set<string>;
  perfMap?: Record<string, ChannelPerfStats>;
  onSelectChannel: (channel: Channel) => void;
  onToggleFavorite: (channel: Channel) => void;
  onRefresh: (scope: 'tr' | 'global' | 'kurdish') => void;
}

const RADIO_GENRES = [
  'Tümü',
  'Kürtçe Radyolar',
  'Pop & Hit',
  'Arabesk & Damar',
  'Türkü & Halk',
  'Slow & Nostalji',
  'Haber & Spor',
  'Dünya Radyoları',
] as const;

type RadioGenre = (typeof RADIO_GENRES)[number];

function matchesGenre(ch: Channel, genre: RadioGenre): boolean {
  if (
    genre === 'Tümü' ||
    genre === 'Dünya Radyoları' ||
    genre === 'Kürtçe Radyolar'
  ) {
    return true;
  }
  const text = `${ch.name} ${ch.tags ?? ''}`.toLocaleLowerCase('tr-TR');
  if (genre === 'Pop & Hit') {
    return /pop|hit|dance|fenomen|power|kral pop|metro|virgin|süper|super|alem|best/.test(
      text
    );
  }
  if (genre === 'Arabesk & Damar') {
    return /arabesk|damar|kral fm|baba|aşk|ask|müslüm|muslum|ahmet kaya|cengiz/.test(
      text
    );
  }
  if (genre === 'Türkü & Halk') {
    return /türkü|turku|halk|karadeniz|ankara|oyun|bağlama|baglama|trt türkü/.test(
      text
    );
  }
  if (genre === 'Slow & Nostalji') {
    return /slow|nostalji|90|80|retro|akustik|joy|pal|altın|altin/.test(text);
  }
  if (genre === 'Haber & Spor') {
    return /haber|ntv|trt|cnn|spor|radyo 1|talk/.test(text);
  }
  return true;
}

export function OnlineRadioTab({
  radios,
  kurdishRadios,
  globalRadios,
  isLoading,
  currentChannel,
  favoriteIds,
  perfMap = {},
  onSelectChannel,
  onToggleFavorite,
  onRefresh,
}: OnlineRadioTabProps) {
  const [genre, setGenre] = useState<RadioGenre>('Tümü');
  const [query, setQuery] = useState('');

  const activeScope: 'tr' | 'global' | 'kurdish' =
    genre === 'Dünya Radyoları'
      ? 'global'
      : genre === 'Kürtçe Radyolar'
      ? 'kurdish'
      : 'tr';

  const sourceList =
    activeScope === 'global'
      ? globalRadios
      : activeScope === 'kurdish'
      ? kurdishRadios
      : radios;

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    const matched = sourceList.filter((ch) => {
      if (!matchesGenre(ch, genre)) return false;
      if (!q) return true;
      return (
        ch.name.toLocaleLowerCase('tr-TR').includes(q) ||
        (ch.tags ?? '').toLocaleLowerCase('tr-TR').includes(q)
      );
    });
    return sortChannelsByPerformance(matched, perfMap);
  }, [sourceList, genre, query, perfMap]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-3 pt-2.5 pb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {activeScope === 'global' ? (
            <Globe className="w-4 h-4 text-[var(--accent)] shrink-0" />
          ) : (
            <Radio className="w-4 h-4 text-[var(--accent)] shrink-0" />
          )}
          <span className="text-xs font-bold text-[var(--ink)] truncate">
            {activeScope === 'global'
              ? 'Dünya Çapında Popüler'
              : activeScope === 'kurdish'
              ? 'Canlı Kürtçe Radyolar'
              : 'Canlı Türkiye Radyoları'}{' '}
            <span className="font-mono-nums text-[var(--muted)]">
              ({filtered.length})
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => onRefresh(activeScope)}
          disabled={isLoading}
          className="touch-compact flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--accent)] text-[11px] font-semibold hover:border-[var(--accent)] disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Yenile</span>
        </button>
      </div>

      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--accent)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Online radyo veya müzik türü ara..."
            className="w-full rounded-xl bg-[var(--bg)] border border-[var(--border)] pl-10 pr-9 py-2 text-[13px] text-[var(--ink)] placeholder-[var(--muted)]/60 focus:outline-none focus:border-[var(--accent)]"
          />
          {query && (
            <button
              type="button"
              aria-label="Temizle"
              onClick={() => setQuery('')}
              className="touch-compact absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--muted)] hover:text-[var(--ink)]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-1.5 px-3 pb-2 overflow-x-auto touch-scroll-x">
        {RADIO_GENRES.map((g) => {
          const selected = g === genre;
          return (
            <button
              key={g}
              type="button"
              data-focus-inset="true"
              onClick={() => {
                setGenre(g);
                if (g === 'Dünya Radyoları' && globalRadios.length === 0) {
                  onRefresh('global');
                } else if (g === 'Kürtçe Radyolar' && kurdishRadios.length === 0) {
                  onRefresh('kurdish');
                } else if (
                  g !== 'Dünya Radyoları' &&
                  g !== 'Kürtçe Radyolar' &&
                  radios.length === 0
                ) {
                  onRefresh('tr');
                }
              }}
              className={`touch-compact shrink-0 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                selected
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                  : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              {g}
            </button>
          );
        })}
      </div>

      {isLoading && filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-3 border-[var(--accent)]/25 border-t-[var(--accent)] animate-spin" />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto touch-scroll-y px-3 py-1 space-y-2 pb-4">
          {filtered.map((station) => (
            <ChannelRowItem
              key={station.id}
              channel={{
                ...station,
                smartCategory:
                  station.codec && station.bitrate
                    ? `${station.codec} · ${station.bitrate} kbps`
                    : 'Canlı Radyo',
              }}
              isPlaying={currentChannel?.id === station.id}
              isFavorite={favoriteIds.has(station.name)}
              onSelect={() => onSelectChannel(station)}
              onToggleFavorite={() => onToggleFavorite(station)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-[var(--muted)]">
              Eşleşen online radyo istasyonu bulunamadı.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
