import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  LayoutGrid,
  Maximize,
  Minimize,
  Maximize2,
  RotateCw,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { AspectMode, BufferPreset, Channel } from '../types/channel';
import { buildHlsConfig } from '../utils/hlsConfig';

interface MultiScreenTileProps {
  index: number;
  channel: Channel | null;
  isSelectedSlot: boolean;
  isAudioActive: boolean;
  aspectMode: AspectMode;
  lowRamMode?: boolean;
  acceleratedPlaybackMode?: boolean;
  bufferPreset?: BufferPreset;
  onSelectSlot: () => void;
  onSetAudioSlot: () => void;
  onFocusSingle: () => void;
}

function MultiScreenTile({
  index,
  channel,
  isSelectedSlot,
  isAudioActive,
  aspectMode,
  lowRamMode = true,
  acceleratedPlaybackMode = true,
  bufferPreset = 'balanced',
  onSelectSlot,
  onSetAudioSlot,
  onFocusSingle,
}: MultiScreenTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const acceleratedRef = useRef(acceleratedPlaybackMode);
  acceleratedRef.current = acceleratedPlaybackMode;
  const bufferPresetRef = useRef(bufferPreset);
  bufferPresetRef.current = bufferPreset;
  const lowRamRef = useRef(lowRamMode);
  lowRamRef.current = lowRamMode;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isAudioActive;
  }, [isAudioActive]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) {
      setIsBuffering(false);
      setHasError(false);
      return;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setHasError(false);
    setIsBuffering(true);

    const params = new URLSearchParams();
    params.set('url', channel.streamUrl);
    if (channel.userAgent) params.set('ua', channel.userAgent);
    if (channel.referer) params.set('referer', channel.referer);
    if (channel.origin) params.set('origin', channel.origin);
    const proxiedUrl = `/api/stream?${params.toString()}`;

    const attemptPlay = async () => {
      try {
        video.muted = !isAudioActive;
        await video.play();
      } catch {
        video.muted = true;
        try {
          await video.play();
        } catch {
          setIsBuffering(false);
        }
      }
    };

    const lowerStream = channel.streamUrl.toLowerCase();
    const cleanLower = lowerStream.split('?')[0].split('#')[0];
    const looksLikeHls =
      cleanLower.endsWith('.m3u8') ||
      cleanLower.endsWith('.m3u') ||
      lowerStream.includes('.m3u8') ||
      lowerStream.includes('/hls/') ||
      lowerStream.includes('workers.dev') ||
      channel.codec === 'HLS';
    const isKnownDirectFile =
      /\.(mp4|mkv|webm|mov|avi|mp3|aac|ogg|flac|wav|opus|ts)$/i.test(cleanLower);
    const isDirectStream =
      (channel.isRadio && !looksLikeHls) ||
      (Boolean(channel.isVod) && !looksLikeHls) ||
      (isKnownDirectFile && !looksLikeHls);

    if (isDirectStream) {
      video.src = proxiedUrl;
      void attemptPlay();
    } else if (Hls.isSupported()) {
      const hls = new Hls(
        buildHlsConfig({
          acceleratedPlaybackMode: acceleratedRef.current,
          bufferPreset: bufferPresetRef.current,
          lowRamMode: lowRamRef.current,
          isMultiScreen: true,
        })
      );
      hlsRef.current = hls;
      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setHasError(false);
        void attemptPlay();
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        setIsBuffering(false);
      });
      hls.on(Hls.Events.ERROR, (_ev, data) => {
        if (!data.fatal) {
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            if (hls.levels.length > 1) hls.nextLevel = 0;
            hls.startLoad();
          }
          return;
        }
        if (
          data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR ||
          data.details === Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR
        ) {
          hls.destroy();
          hlsRef.current = null;
          video.src = proxiedUrl;
          void attemptPlay();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else {
          setHasError(true);
          setIsBuffering(false);
          hls.destroy();
        }
      });
    } else {
      video.src = proxiedUrl;
      void attemptPlay();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [channel, retryTick]);

  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    Object.assign(
      hls.config,
      buildHlsConfig({
        acceleratedPlaybackMode,
        bufferPreset,
        lowRamMode,
        isMultiScreen: true,
      })
    );
  }, [acceleratedPlaybackMode, bufferPreset, lowRamMode]);

  const objectFitClass =
    aspectMode === 'fit'
      ? 'object-contain'
      : aspectMode === 'fill'
      ? 'object-fill'
      : 'object-cover';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelectSlot}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Select' || e.key === 'DPadCenter') {
          e.preventDefault();
          onSelectSlot();
        }
      }}
      className={`relative bg-black overflow-hidden select-none touch-manipulation cursor-pointer focus:outline-none transition-colors ${
        isSelectedSlot
          ? 'ring-2 ring-inset ring-[var(--accent)]'
          : 'ring-1 ring-inset ring-[var(--border)] hover:ring-white/30'
      }`}
    >
      {channel ? (
        <>
          <video
            ref={videoRef}
            playsInline
            muted={!isAudioActive}
            onWaiting={() => setIsBuffering(true)}
            onPlaying={() => {
              setIsBuffering(false);
              setHasError(false);
            }}
            onCanPlay={() => setIsBuffering(false)}
            onError={() => {
              setHasError(true);
              setIsBuffering(false);
            }}
            className={`w-full h-full bg-black ${objectFitClass}`}
          />

          {isBuffering && !hasError && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-7 h-7 rounded-full border-2 border-[var(--accent)]/25 border-t-[var(--accent)] animate-spin" />
            </div>
          )}

          {hasError && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-2 text-center"
            >
              <span className="text-[11px] font-medium text-[var(--live)]">
                Yayın açılamadı
              </span>
              <button
                type="button"
                onClick={() => setRetryTick((t) => t + 1)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-[10px] font-extrabold hover:bg-[var(--accent-hover)]"
              >
                <RotateCw className="w-3 h-3" />
                <span>Tekrar</span>
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-[var(--surface-2)]">
          <Tv className="w-6 h-6 text-[var(--muted)] mb-1.5" />
          <div className="text-xs font-semibold text-[var(--ink)]">
            Ekran {index + 1} Boş
          </div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">
            {isSelectedSlot
              ? 'Listeden bir kanal seçin'
              : 'Atamak için bu alana tıklayın'}
          </div>
        </div>
      )}

      {/* Top Tile Bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-gradient-to-b from-black/85 via-black/45 to-transparent">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`font-mono-nums text-[10px] font-bold px-1.5 py-0.5 rounded ${
              isSelectedSlot
                ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                : 'bg-black/60 text-white border border-white/20'
            }`}
          >
            {index + 1}
          </span>
          <span className="text-[11px] font-bold text-white truncate">
            {channel ? channel.name : 'Kanal bekleniyor'}
          </span>
        </div>

        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {channel && (
            <>
              <button
                type="button"
                onClick={onSetAudioSlot}
                title={isAudioActive ? 'Ses Bu Ekranda' : 'Sesi Bu Ekrana Al'}
                className={`touch-compact min-w-[34px] min-h-[34px] flex items-center justify-center p-1.5 rounded-lg text-xs transition-colors focus:outline-none ${
                  isAudioActive
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'bg-black/65 text-white/85 hover:text-white'
                }`}
              >
                {isAudioActive ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={onFocusSingle}
                title="Tek Ekranda Büyüt"
                className="touch-compact min-w-[34px] min-h-[34px] flex items-center justify-center p-1.5 rounded-lg bg-black/65 text-white/85 hover:text-white focus:outline-none"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface MultiScreenGridProps {
  layout: 2 | 4;
  slots: (Channel | null)[];
  activeSlotIndex: number;
  audioSlotIndex: number;
  aspectMode: AspectMode;
  isFullscreen: boolean;
  lowRamMode?: boolean;
  acceleratedPlaybackMode?: boolean;
  bufferPreset?: BufferPreset;
  onSelectSlot: (idx: number) => void;
  onSetAudioSlot: (idx: number) => void;
  onFocusSingle: (idx: number) => void;
  onCycleLayout: () => void;
  onExitMultiScreen: () => void;
  onToggleFullscreen: (enable: boolean) => void;
}

export function MultiScreenGrid({
  layout,
  slots,
  activeSlotIndex,
  audioSlotIndex,
  aspectMode,
  isFullscreen,
  lowRamMode = true,
  acceleratedPlaybackMode = true,
  bufferPreset = 'balanced',
  onSelectSlot,
  onSetAudioSlot,
  onFocusSingle,
  onCycleLayout,
  onExitMultiScreen,
  onToggleFullscreen,
}: MultiScreenGridProps) {
  const visibleSlots = slots.slice(0, layout);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key >= '1' && e.key <= String(layout)) {
        const idx = Number(e.key) - 1;
        onSelectSlot(idx);
        onSetAudioSlot(idx);
      } else if (isFullscreen && (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack')) {
        e.preventDefault();
        onToggleFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout, isFullscreen, onSelectSlot, onSetAudioSlot, onToggleFullscreen]);

  return (
    <div
      className={`flex flex-col bg-black touch-manipulation ${
        isFullscreen ? 'fixed inset-0 z-50 w-screen h-dvh' : 'w-full h-full'
      }`}
    >
      {/* Multi-Screen Control Strip */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2 min-w-0">
          <LayoutGrid className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <span className="text-xs font-bold text-[var(--ink)] truncate">
            Çoklu Ekran ({layout}&apos;li) · Aktif Alan: Ekran {activeSlotIndex + 1}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onCycleLayout}
            className="px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] text-xs font-semibold hover:border-[var(--accent)] whitespace-nowrap"
          >
            {layout === 2 ? "4'lü Ekran" : "2'li Ekran"}
          </button>
          <button
            type="button"
            onClick={() => onToggleFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
            className="p-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--accent)] hover:border-[var(--accent)]"
          >
            {isFullscreen ? (
              <Minimize className="w-4 h-4" />
            ) : (
              <Maximize className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onExitMultiScreen}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)] whitespace-nowrap"
          >
            <X className="w-3.5 h-3.5" />
            <span>Tek Ekran</span>
          </button>
        </div>
      </div>

      {/* Grid of Simultaneous Live Streams */}
      <div
        className={`flex-1 min-h-0 grid gap-0.5 bg-[var(--bg)] ${
          layout === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 grid-rows-2'
        }`}
      >
        {visibleSlots.map((ch, idx) => (
          <MultiScreenTile
            key={idx}
            index={idx}
            channel={ch}
            isSelectedSlot={idx === activeSlotIndex}
            isAudioActive={idx === audioSlotIndex}
            aspectMode={aspectMode}
            lowRamMode={lowRamMode}
            acceleratedPlaybackMode={acceleratedPlaybackMode}
            bufferPreset={bufferPreset}
            onSelectSlot={() => onSelectSlot(idx)}
            onSetAudioSlot={() => onSetAudioSlot(idx)}
            onFocusSingle={() => onFocusSingle(idx)}
          />
        ))}
      </div>
    </div>
  );
}
