import { useState } from 'react';
import { Heart, Radio, Tv } from 'lucide-react';
import type { Channel } from '../types/channel';

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

export function ChannelRowItem({
  channel,
  isPlaying,
  isFavorite,
  isFocused = false,
  compact = false,
  epgNow = null,
  onSelect,
  onToggleFavorite,
}: ChannelRowItemProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const logoSrc =
    channel.logoUrl && !imgFailed
      ? `/api/logo?url=${encodeURIComponent(channel.logoUrl)}`
      : null;

  return (
    <div
      role="button"
      tabIndex={0}
      data-channel-id={channel.id}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group w-full flex items-center rounded-xl border transition-colors cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
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
            onError={() => setImgFailed(true)}
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
            <span className="text-[var(--accent)] font-bold shrink-0">
              · RADYO
            </span>
          )}
        </div>
        {epgNow && (
          <div className="mt-0.5 text-[11px] text-[var(--accent)]/90 truncate">
            Şimdi: {epgNow}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label="Favori"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="ml-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-colors"
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
}
