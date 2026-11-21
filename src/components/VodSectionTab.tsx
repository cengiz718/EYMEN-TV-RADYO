import { useMemo, useState } from 'react';
import {
  ChevronRight,
  Clapperboard,
  Film,
  Heart,
  Play,
  Plus,
  Search,
  Sparkles,
  Tv2,
  X,
} from 'lucide-react';
import type {
  Channel,
  VodItem,
  VodProgressEntry,
  XtreamSeriesEntry,
  XtreamVodAuth,
} from '../types/channel';
import { vodItemToChannel } from '../utils/vodParser';

interface VodSectionTabProps {
  vodItems: VodItem[];
  xtreamSeries: XtreamSeriesEntry[];
  xtreamAuth: XtreamVodAuth | null;
  progressMap: Record<string, VodProgressEntry>;
  favoriteIds: Set<string>;
  currentChannel: Channel | null;
  cinemaLiveCount: number;
  onPlayVodItem: (item: VodItem) => void;
  onPlayEpisodeChannel: (ch: Channel) => void;
  onToggleFavorite: (ch: Channel) => void;
  onOpenImportModal: () => void;
  onExtractCinemaFromLive: () => void;
}

type VodKindFilter = 'all' | 'movie' | 'series' | 'resume';

interface SeriesEpisodeDto {
  id: string;
  season: number;
  episodeNum: number;
  title: string;
  streamUrl: string;
}

function PosterThumb({
  posterUrl,
  isSeries,
  name,
}: {
  posterUrl: string | null;
  isSeries: boolean;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const src =
    posterUrl && !failed ? `/api/logo?url=${encodeURIComponent(posterUrl)}` : null;

  return (
    <div className="w-full aspect-[16/10] bg-[var(--bg)] border-b border-[var(--border)] flex items-center justify-center overflow-hidden relative">
      {src ? (
        <img
          src={src}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : isSeries ? (
        <Tv2 className="w-7 h-7 text-[var(--accent)]/80" />
      ) : (
        <Clapperboard className="w-7 h-7 text-[var(--accent)]/80" />
      )}
    </div>
  );
}

export function VodSectionTab({
  vodItems,
  xtreamSeries,
  xtreamAuth,
  progressMap,
  favoriteIds,
  currentChannel,
  cinemaLiveCount,
  onPlayVodItem,
  onPlayEpisodeChannel,
  onToggleFavorite,
  onOpenImportModal,
  onExtractCinemaFromLive,
}: VodSectionTabProps) {
  const [kindFilter, setKindFilter] = useState<VodKindFilter>('all');
  const [selectedAutoCat, setSelectedAutoCat] = useState<string>('Tümü');
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(60);

  // Xtream series episode drawer state
  const [activeSeries, setActiveSeries] = useState<XtreamSeriesEntry | null>(null);
  const [episodes, setEpisodes] = useState<SeriesEpisodeDto[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [episodesError, setEpisodesError] = useState<string | null>(null);

  // Combine M3U VOD items + Xtream Series entries into a unified browseable list
  const unifiedEntries = useMemo(() => {
    const items = vodItems.map((item) => ({
      kind: 'vod' as const,
      id: item.id,
      name: item.name,
      posterUrl: item.posterUrl,
      type: item.type,
      autoCategory: item.autoCategory,
      year: item.year,
      seasonEpisode: item.seasonEpisode,
      vodItem: item,
      seriesEntry: null as XtreamSeriesEntry | null,
    }));

    const seriesEntries = xtreamSeries.map((s) => ({
      kind: 'xtream-series' as const,
      id: `xs_${s.seriesId}`,
      name: s.name,
      posterUrl: s.posterUrl,
      type: 'series' as const,
      autoCategory: s.category || 'Diziler',
      year: s.year,
      seasonEpisode: undefined,
      vodItem: null as VodItem | null,
      seriesEntry: s,
    }));

    return [...items, ...seriesEntries];
  }, [vodItems, xtreamSeries]);

  // Automatic categories built dynamically from the user's added list!
  const autoCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of unifiedEntries) {
      if (kindFilter === 'movie' && entry.type !== 'movie') continue;
      if (kindFilter === 'series' && entry.type !== 'series') continue;
      if (kindFilter === 'resume') {
        const p = progressMap[entry.id];
        if (!p || p.currentTime < 10) continue;
      }
      counts.set(entry.autoCategory, (counts.get(entry.autoCategory) || 0) + 1);
    }

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return [{ name: 'Tümü', count: sorted.reduce((acc, x) => acc + x[1], 0) }, ...sorted.map(([name, count]) => ({ name, count }))];
  }, [unifiedEntries, kindFilter, progressMap]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    return unifiedEntries.filter((entry) => {
      if (kindFilter === 'movie' && entry.type !== 'movie') return false;
      if (kindFilter === 'series' && entry.type !== 'series') return false;
      if (kindFilter === 'resume') {
        const p = progressMap[entry.id];
        if (!p || p.currentTime < 10) return false;
      }
      if (selectedAutoCat !== 'Tümü' && entry.autoCategory !== selectedAutoCat) {
        return false;
      }
      if (q && !entry.name.toLocaleLowerCase('tr-TR').includes(q)) {
        return false;
      }
      return true;
    });
  }, [unifiedEntries, kindFilter, selectedAutoCat, query, progressMap]);

  const openXtreamSeries = async (series: XtreamSeriesEntry) => {
    if (!xtreamAuth) return;
    setActiveSeries(series);
    setEpisodes([]);
    setEpisodesError(null);
    setLoadingEpisodes(true);
    try {
      const res = await fetch('/api/xtream/series-episodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: xtreamAuth.server,
          username: xtreamAuth.username,
          password: xtreamAuth.password,
          seriesId: series.seriesId,
        }),
      });
      const data = (await res.json()) as {
        episodes?: SeriesEpisodeDto[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Bölümler alınamadı');
      setEpisodes(data.episodes || []);
    } catch (err) {
      setEpisodesError(
        err instanceof Error ? err.message : 'Bölümler yüklenemedi.'
      );
    } finally {
      setLoadingEpisodes(false);
    }
  };

  if (unifiedEntries.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mb-3">
          <Film className="w-6 h-6 text-[var(--accent)]" />
        </div>
        <h2 className="text-sm font-extrabold text-[var(--ink)]">
          Film &amp; Dizi Arşivi
        </h2>
        <p className="mt-1.5 text-xs text-[var(--muted)] max-w-xs leading-relaxed">
          Kendi Film / Dizi M3U bağlantınızı, dosyanızı veya Xtream hesabınızı ekleyin. Tüm türler ve sezon kategorileri otomatik oluşturulur.
        </p>

        <div className="mt-4 flex flex-col gap-2 w-full max-w-xs">
          <button
            type="button"
            onClick={onOpenImportModal}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)]"
          >
            <Plus className="w-4 h-4" />
            <span>Film / Dizi Listesi Ekle</span>
          </button>

          {cinemaLiveCount > 0 && (
            <button
              type="button"
              onClick={onExtractCinemaFromLive}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] text-xs font-semibold hover:border-[var(--accent)]"
            >
              <Sparkles className="w-4 h-4 text-[var(--accent)]" />
              <span>
                Mevcut Listeden {cinemaLiveCount} Sinema/Dizi Aktar
              </span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      {/* Top Action Strip */}
      <div className="shrink-0 px-3 pt-2.5 pb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <span className="text-xs font-bold text-[var(--ink)] truncate">
            Film &amp; Dizi{' '}
            <span className="font-mono-nums text-[var(--muted)]">
              ({filtered.length})
            </span>
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenImportModal}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-[11px] font-bold hover:bg-[var(--accent-hover)] whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Liste Ekle</span>
        </button>
      </div>

      {/* Type Filter Segmented Control */}
      <div className="shrink-0 px-3 pb-2">
        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
          {(
            [
              { id: 'all', label: 'Tümü' },
              { id: 'movie', label: 'Filmler' },
              { id: 'series', label: 'Diziler' },
              { id: 'resume', label: 'Kaldığın' },
            ] as const
          ).map((item) => {
            const active = kindFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setKindFilter(item.id);
                  setSelectedAutoCat('Tümü');
                }}
                className={`py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--accent)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Film, dizi veya tür ara..."
            className="w-full rounded-xl bg-[var(--surface)] border border-[var(--border)] pl-10 pr-9 py-2 text-[13px] text-[var(--ink)] placeholder-[var(--muted)]/60 focus:outline-none focus:border-[var(--accent)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--muted)] hover:text-[var(--ink)]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Automatic Categories Bar (Generated from list) */}
      <div className="shrink-0 flex items-center gap-1.5 px-3 pb-2 overflow-x-auto">
        {autoCategories.map((cat) => {
          const active = cat.name === selectedAutoCat;
          return (
            <button
              key={cat.name}
              type="button"
              onClick={() => setSelectedAutoCat(cat.name)}
              className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors ${
                active
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                  : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              {cat.name}{' '}
              <span className="font-mono-nums opacity-75">({cat.count})</span>
            </button>
          );
        })}
      </div>

      {/* Poster Grid */}
      <div
        onScroll={(e) => {
          const el = e.currentTarget;
          if (
            el.scrollHeight - el.scrollTop - el.clientHeight < 300 &&
            visibleLimit < filtered.length
          ) {
            setVisibleLimit((prev) => Math.min(prev + 60, filtered.length));
          }
        }}
        className="flex-1 min-h-0 overflow-y-auto px-3 pb-4"
      >
        <div className="grid grid-cols-2 gap-2.5">
          {filtered.slice(0, visibleLimit).map((entry) => {
            const prog = progressMap[entry.id];
            const pct =
              prog && prog.duration > 10
                ? Math.min(100, Math.round((prog.currentTime / prog.duration) * 100))
                : 0;
            const isPlaying = currentChannel?.id === entry.id;
            const isFav = favoriteIds.has(entry.name);

            return (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (entry.kind === 'vod' && entry.vodItem) {
                    onPlayVodItem(entry.vodItem);
                  } else if (entry.kind === 'xtream-series' && entry.seriesEntry) {
                    void openXtreamSeries(entry.seriesEntry);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (entry.kind === 'vod' && entry.vodItem) {
                      onPlayVodItem(entry.vodItem);
                    } else if (entry.kind === 'xtream-series' && entry.seriesEntry) {
                      void openXtreamSeries(entry.seriesEntry);
                    }
                  }
                }}
                className={`group rounded-xl border overflow-hidden cursor-pointer select-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  isPlaying
                    ? 'bg-[var(--surface-elevated)] border-[var(--accent)]'
                    : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--accent)]/60'
                }`}
              >
                <div className="relative">
                  <PosterThumb
                    posterUrl={entry.posterUrl}
                    isSeries={entry.type === 'series'}
                    name={entry.name}
                  />
                  {pct > 0 && (
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-black/70">
                      <div
                        className="h-full bg-[var(--accent)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label="Favori"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (entry.vodItem) {
                        onToggleFavorite(vodItemToChannel(entry.vodItem));
                      }
                    }}
                    className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${
                        isFav ? 'fill-[var(--live)] text-[var(--live)]' : 'text-white/80'
                      }`}
                    />
                  </button>
                </div>

                <div className="p-2.5">
                  <div
                    className={`text-xs font-bold line-clamp-2 leading-snug ${
                      isPlaying ? 'text-[var(--accent)]' : 'text-[var(--ink)]'
                    }`}
                  >
                    {entry.name}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-1 text-[10px] text-[var(--muted)]">
                    <span className="truncate">{entry.autoCategory}</span>
                    {(entry.seasonEpisode || entry.year) && (
                      <span className="font-mono-nums text-[var(--accent)] font-semibold shrink-0">
                        {entry.seasonEpisode || entry.year}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="py-10 text-center text-xs text-[var(--muted)]">
            Bu kategoride veya aramada film/dizi bulunamadı.
          </div>
        )}
      </div>

      {/* Xtream Series Episode Picker Overlay */}
      {activeSeries && (
        <div className="absolute inset-0 z-20 bg-[var(--bg)] flex flex-col">
          <div className="shrink-0 flex items-center justify-between gap-2 px-3.5 py-3 bg-[var(--surface-2)] border-b border-[var(--border)]">
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-[var(--ink)] truncate">
                {activeSeries.name}
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                {activeSeries.category} · Bölümler
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveSeries(null)}
              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {loadingEpisodes ? (
              <div className="py-12 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full border-3 border-[var(--accent)]/25 border-t-[var(--accent)] animate-spin" />
              </div>
            ) : episodesError ? (
              <div className="py-10 text-center text-xs text-[var(--live)]">
                {episodesError}
              </div>
            ) : episodes.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--muted)]">
                Bu dizi için bölüm bulunamadı.
              </div>
            ) : (
              episodes.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => {
                    onPlayEpisodeChannel({
                      id: `ep_${ep.id}`,
                      name: `${activeSeries.name} - S${String(ep.season).padStart(2, '0')}E${String(ep.episodeNum).padStart(2, '0')}`,
                      streamUrl: ep.streamUrl,
                      logoUrl: activeSeries.posterUrl,
                      originalGroup: activeSeries.category,
                      smartCategory: activeSeries.category,
                      isRadio: false,
                      isVod: true,
                      userAgent:
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
                      referer: '',
                      origin: '',
                      source: 'vod',
                    });
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)] text-left"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Play className="w-4 h-4 text-[var(--accent)] shrink-0" />
                    <div className="min-w-0">
                      <div className="font-mono-nums text-[11px] font-bold text-[var(--accent)]">
                        Sezon {ep.season} · Bölüm {ep.episodeNum}
                      </div>
                      <div className="text-xs font-semibold text-[var(--ink)] truncate">
                        {ep.title}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--muted)] shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
