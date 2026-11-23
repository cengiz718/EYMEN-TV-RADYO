import { memo, useEffect, useState } from 'react';
import { Heart, Radio, Tv } from 'lucide-react';
import type { Channel } from '../types/channel';
import { buildChannelLogoProxyUrl } from '../utils/logoResolver';
import { isRemoteSelectKey } from '../utils/remoteKeys';

interface ChannelRowItemProps {
  channel: Channel;
  isPlaying: boolean;
  isFavorite: boolean;
  isFocused?: boolean;
  compact?: boolean;
  epgNow?: string | null;
  onSelect: () => void;
  onToggleFavorite: () => void;
}

export const ChannelRowItem = memo(function ChannelRowItem({
  channel,
  isPlaying,
  isFavorite,
  isFocused = false,
  compact = false,
  epgNow = null,
  onSelect,
  onToggleFavorite,
}: ChannelRowItemProps) {
  const [fallbackStage, setFallbackStage] = useState<'primary' | 'byName' | 'failed'>('primary');

  useEffect(() => {
    setFallbackStage('primary');
  }, [channel.id, channel.logoUrl]);

  const primaryLogoSrc = buildChannelLogoProxyUrl(channel);
  const logoSrc =
    fallbackStage === 'primary'
      ? primaryLogoSrc
      : fallbackStage === 'byName'
      ? `/api/logo?name=${encodeURIComponent(channel.name)}${channel.isRadio ? '&radio=1' : ''}`
      : null;

  return (
    <div
      role="button"
      tabIndex={0}
      data-focus-inset="true"
      data-channel-id={channel.id}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (isRemoteSelectKey(e)) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group w-full min-h-[54px] flex items-center rounded-xl border transition-colors cursor-pointer select-none touch-manipulation active:scale-[0.99] focus:outline-none focus:bg-[var(--surface-elevated)] focus:border-[var(--accent)] ${
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
      } ${
        isPlaying
          ? 'bg-[var(--surface-elevated)] border-[var(--accent)]'
          : isFocused
          ? 'bg-[var(--surface-elevated)] border-[var(--border-strong)] ring-1 ring-[var(--accent)]/50'
          : 'bg-[var(--surface)] border-[var(--border)] hover:bg-[var(--surface-elevated)]'
      }`}
    >
      <div
        className={`shrink-0 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center overflow-hidden ${
          compact ? 'w-9 h-9' : 'w-11 h-11'
        }`}
      >
        {logoSrc ? (
          <img
            src={logoSrc}
            alt={channel.name}
            loading="lazy"
            decoding="async"
            onError={() =>
              setFallbackStage((prev) => (prev === 'primary' ? 'byName' : 'failed'))
            }
            className="w-full h-full object-contain p-1"
          />
        ) : channel.isRadio ? (
          <Radio className="w-5 h-5 text-[var(--accent)]" />
        ) : (
          <Tv className="w-5 h-5 text-[var(--accent)]" />
        )}
      </div>

      <div className="ml-3 flex-1 min-w-0">
        <div
          className={`font-semibold truncate ${
            compact ? 'text-[13px]' : 'text-[14px]'
          } ${isPlaying ? 'text-[var(--accent)]' : 'text-[var(--ink)]'}`}
        >
          {channel.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--muted)] truncate">
          <span className="truncate">{channel.smartCategory}</span>
          {channel.isRadio && (
            <span className="text-[var(--accent)] font-semibold shrink-0">
              · Radyo
            </span>
          )}
          {epgNow && (
            <span className="text-[var(--accent)]/90 truncate">
              · {epgNow}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        aria-label="Favori"
        data-focus-inset="true"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="ml-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-colors"
      >
        <Heart
          className={`w-5 h-5 ${
            isFavorite
              ? 'fill-[var(--live)] text-[var(--live)]'
              : 'text-[var(--muted)] group-hover:text-[var(--ink)]'
          }`}
        />
      </button>
    </div>
  );
});
