import { useEffect, useRef, useState, useCallback, type TouchEvent } from 'react';
import Hls from 'hls.js';
import {
  CalendarClock,
  LayoutGrid,
  List,
  Maximize,
  Minimize,
  Pause,
  Play,
  Ratio,
  RotateCcw,
  RotateCw,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  AspectMode,
  CategoryName,
  Channel,
  EpgNowNext,
  PlayerControlsSize,
  RadioEffectIntensity,
  RadioEffectMode,
} from '../types/channel';
import { computeEpgProgress, formatEpgTime, lookupEpgForChannel } from '../utils/epg';
import { RadioVisualizerOverlay } from './RadioVisualizerOverlay';
import { ChannelRowItem } from './ChannelRowItem';

interface VideoPlayerSurfaceProps {
  currentChannel: Channel | null;
  channels: Channel[];
  visibleCategories: CategoryName[];
  selectedCategory: CategoryName;
  searchQuery: string;
  favoriteIds: Set<string>;
  aspectMode: AspectMode;
  isFullscreen: boolean;
  pauseSignal: number;
  hudHideSeconds?: number;
  controlsSize?: PlayerControlsSize;
  highContrastControls?: boolean;
  seekStepSeconds?: number;
  radioEffectMode?: RadioEffectMode;
  radioEffectIntensity?: RadioEffectIntensity;
  radioShowLogo?: boolean;
  radioBackgroundImage?: string;
  epgMap?: Record<string, EpgNowNext>;
  vodResumeTime?: number;
  onVodProgress?: (channelId: string, currentTime: number, duration: number) => void;
  onSelectChannel: (channel: Channel) => void;
  onSelectCategory: (cat: CategoryName) => void;
  onSearchChange: (q: string) => void;
  onToggleFavorite: (channel: Channel) => void;
  onToggleFullscreen: (enable: boolean) => void;
  onToggleAspect: () => void;
  onEnableMultiScreen?: () => void;
  onOpenEpg?: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function VideoPlayerSurface({
  currentChannel,
  channels,
  visibleCategories,
  selectedCategory,
  searchQuery,
  favoriteIds,
  aspectMode,
  isFullscreen,
  pauseSignal,
  hudHideSeconds = 4,
  controlsSize = 'large',
  highContrastControls = true,
  seekStepSeconds = 15,
  radioEffectMode = 'aurora',
  radioEffectIntensity = 'vivid',
  radioShowLogo = true,
  radioBackgroundImage = '',
  epgMap = {},
  vodResumeTime = 0,
  onVodProgress,
  onSelectChannel,
  onSelectCategory,
  onSearchChange,
  onToggleFavorite,
  onToggleFullscreen,
  onToggleAspect,
  onEnableMultiScreen,
  onOpenEpg,
  onPrev,
  onNext,
}: VideoPlayerSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const drawerListRef = useRef<HTMLDivElement | null>(null);

  const [isBuffering, setIsBuffering] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [needsUnmutePrompt, setNeedsUnmutePrompt] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [vodTime, setVodTime] = useState(0);
  const [vodDuration, setVodDuration] = useState(0);
  const [seekToast, setSeekToast] = useState<string | null>(null);
  const lastSavedTickRef = useRef(0);
  const didResumeSeekRef = useRef(false);
  const seekToastTimerRef = useRef<number | null>(null);

  // Fullscreen HUD & Channel List Drawer state (Mi Box & Mobile Touch)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [drawerLimit, setDrawerLimit] = useState(80);
  const hudTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const resetHudTimer = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current !== null) {
      window.clearTimeout(hudTimerRef.current);
    }
    if (isFullscreen && !drawerOpen && !playerError) {
      hudTimerRef.current = window.setTimeout(() => {
        setHudVisible(false);
      }, Math.max(2, hudHideSeconds) * 1000);
    }
  }, [isFullscreen, drawerOpen, playerError, hudHideSeconds]);

  useEffect(() => {
    if (!isFullscreen) {
      setDrawerOpen(false);
      setHudVisible(true);
      if (hudTimerRef.current !== null) {
        window.clearTimeout(hudTimerRef.current);
      }
    } else {
      resetHudTimer();
    }
  }, [isFullscreen, resetHudTimer]);

  useEffect(() => {
    setDrawerLimit(80);
    setFocusedIndex(0);
  }, [selectedCategory, searchQuery]);

  useEffect(() => {
    if (drawerOpen && currentChannel) {
      const idx = channels.findIndex((c) => c.id === currentChannel.id);
      if (idx >= 0) {
        setFocusedIndex(idx);
        if (idx >= drawerLimit) {
          setDrawerLimit(idx + 40);
        }
        window.setTimeout(() => {
          const el = drawerListRef.current?.querySelector(
            `[data-channel-id="${CSS.escape(currentChannel.id)}"]`
          );
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 50);
      }
    }
  }, [drawerOpen, currentChannel, channels, drawerLimit]);

  useEffect(() => {
    if (pauseSignal > 0 && videoRef.current) {
      videoRef.current.pause();
    }
  }, [pauseSignal]);

  // Load & play stream via /api/stream proxy
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentChannel) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setPlayerError(null);
    setIsBuffering(true);
    setNeedsUnmutePrompt(false);
    setVodTime(0);
    setVodDuration(0);
    lastSavedTickRef.current = 0;
    didResumeSeekRef.current = false;

    const params = new URLSearchParams();
    params.set('url', currentChannel.streamUrl);
    if (currentChannel.userAgent) params.set('ua', currentChannel.userAgent);
    if (currentChannel.referer) params.set('referer', currentChannel.referer);
    if (currentChannel.origin) params.set('origin', currentChannel.origin);
    const proxiedUrl = `/api/stream?${params.toString()}`;

    const attemptPlay = async () => {
      try {
        await video.play();
        setIsPlaying(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          video.muted = true;
          setIsMuted(true);
          setNeedsUnmutePrompt(true);
          try {
            await video.play();
            setIsPlaying(true);
          } catch {
            setIsPlaying(false);
            setIsBuffering(false);
          }
        } else {
          setIsBuffering(false);
        }
      }
    };

    const lowerStream = currentChannel.streamUrl.toLowerCase();
    const looksLikeHls =
      lowerStream.includes('.m3u8') ||
      lowerStream.includes('hls') ||
      lowerStream.includes('workers.dev') ||
      currentChannel.codec === 'HLS';
    const isDirectStream =
      (currentChannel.isRadio && !looksLikeHls) ||
      (Boolean(currentChannel.isVod) && !looksLikeHls);

    const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';

    if (isDirectStream) {
      video.src = proxiedUrl;
      void attemptPlay();
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingTimeOut: 15000,
        levelLoadingTimeOut: 15000,
        fragLoadingTimeOut: 20000,
      });
      hlsRef.current = hls;

      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerError(null);
        void attemptPlay();
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (currentChannel.isRadio) {
            hls.destroy();
            hlsRef.current = null;
            video.src = proxiedUrl;
            void attemptPlay();
            return;
          }
          setPlayerError('Yayın bağlanamadı (Ağ hatası). Alternatif yayını deneyin.');
          setIsBuffering(false);
          hls.destroy();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setPlayerError('Yayın bağlanamadı. Alternatif yayını deneyin.');
          setIsBuffering(false);
          hls.destroy();
        }
      });
    } else if (canNativeHls) {
      video.src = proxiedUrl;
      void attemptPlay();
    } else {
      video.src = proxiedUrl;
      void attemptPlay();
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentChannel.name,
        artist: `${currentChannel.smartCategory} · CANLI`,
        album: 'Eymen TV & Radyo',
        artwork: currentChannel.logoUrl
          ? [
              {
                src: `/api/logo?url=${encodeURIComponent(currentChannel.logoUrl)}`,
                sizes: '256x256',
                type: 'image/png',
              },
            ]
          : [],
      });
      navigator.mediaSession.setActionHandler('previoustrack', onPrev);
      navigator.mediaSession.setActionHandler('nexttrack', onNext);
      navigator.mediaSession.setActionHandler('play', () => void video.play());
      navigator.mediaSession.setActionHandler('pause', () => video.pause());
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [currentChannel, retryCount, onPrev, onNext]);

  // Keyboard / Mi Box TV Remote navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (isTyping) {
        if (e.key === 'Escape' && drawerOpen) {
          e.preventDefault();
          setDrawerOpen(false);
        }
        return;
      }

      resetHudTimer();

      if (e.key === 'MediaTrackNext' || e.key === 'ChannelUp') {
        e.preventDefault();
        onNext();
        return;
      }
      if (e.key === 'MediaTrackPrevious' || e.key === 'ChannelDown') {
        e.preventDefault();
        onPrev();
        return;
      }

      if (!isFullscreen) return;

      if (e.key === 'Escape' || e.key === 'GoBack') {
        e.preventDefault();
        if (drawerOpen) {
          setDrawerOpen(false);
        } else {
          onToggleFullscreen(false);
        }
        return;
      }

      if (
        e.key === 'l' ||
        e.key === 'L' ||
        e.key === 'm' ||
        e.key === 'M' ||
        e.key === 'ContextMenu'
      ) {
        e.preventDefault();
        setDrawerOpen((prev) => !prev);
        return;
      }

      if (drawerOpen) {
        const currentVisibleCount = Math.min(channels.length, drawerLimit);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = Math.min(prev + 1, channels.length - 1);
            if (next >= drawerLimit - 5) setDrawerLimit((l) => l + 50);
            const ch = channels[next];
            if (ch) {
              drawerListRef.current
                ?.querySelector(`[data-channel-id="${CSS.escape(ch.id)}"]`)
                ?.scrollIntoView({ block: 'nearest' });
            }
            return next;
          });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            const ch = channels[next];
            if (ch) {
              drawerListRef.current
                ?.querySelector(`[data-channel-id="${CSS.escape(ch.id)}"]`)
                ?.scrollIntoView({ block: 'nearest' });
            }
            return next;
          });
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setDrawerOpen(false);
        } else if (e.key === 'ArrowRight' && visibleCategories.length > 0) {
          e.preventDefault();
          const idx = visibleCategories.indexOf(selectedCategory);
          const nextCat =
            visibleCategories[(idx + 1) % visibleCategories.length];
          onSelectCategory(nextCat);
        } else if (e.key === 'Enter' && currentVisibleCount > 0) {
          e.preventDefault();
          const ch = channels[focusedIndex];
          if (ch) {
            onSelectChannel(ch);
          }
        }
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setDrawerOpen(true);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const video = videoRef.current;
        if (video) {
          if (video.paused) void video.play();
          else video.pause();
        }
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        onToggleFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isFullscreen,
    drawerOpen,
    channels,
    drawerLimit,
    focusedIndex,
    selectedCategory,
    visibleCategories,
    onNext,
    onPrev,
    onSelectChannel,
    onSelectCategory,
    onToggleFullscreen,
    resetHudTimer,
  ]);

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
    resetHudTimer();
  };

  const seekBySeconds = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const seekable = video.seekable;
    let minT = 0;
    let maxT = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : video.currentTime;
    if (seekable && seekable.length > 0) {
      minT = seekable.start(0);
      maxT = seekable.end(seekable.length - 1);
    }
    if (maxT > minT + 1) {
      const target = Math.min(maxT, Math.max(minT, video.currentTime + delta));
      video.currentTime = target;
      setVodTime(target);
      setSeekToast(`${delta > 0 ? '+' : ''}${delta} sn`);
    } else {
      setSeekToast('Canlı yayında ileri/geri sarma yalnızca arşivde çalışır');
    }
    if (seekToastTimerRef.current !== null) {
      window.clearTimeout(seekToastTimerRef.current);
    }
    seekToastTimerRef.current = window.setTimeout(() => setSeekToast(null), 1500);
    resetHudTimer();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    if (!video.muted) setNeedsUnmutePrompt(false);
    resetHudTimer();
  };

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (!isFullscreen || drawerOpen) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (!isFullscreen || drawerOpen || !touchStartRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx > 0) {
        setDrawerOpen(true);
      } else {
        onNext();
      }
      resetHudTimer();
    } else if (Math.abs(dy) > 65 && Math.abs(dy) > Math.abs(dx) * 1.4) {
      if (dy < 0) onNext();
      else onPrev();
      resetHudTimer();
    }
  };

  const objectFitClass =
    aspectMode === 'fit'
      ? 'object-contain'
      : aspectMode === 'fill'
      ? 'object-fill'
      : 'object-cover';

  const aspectLabel =
    aspectMode === 'fit' ? 'Sığdır' : aspectMode === 'fill' ? 'Doldur' : 'Yakınlaştır';

  const showControls = !isFullscreen || hudVisible || drawerOpen || !!playerError;
  const currentEpg = currentChannel
    ? lookupEpgForChannel(epgMap, currentChannel.name)
    : null;
  const currentProgress =
    currentEpg?.now
      ? computeEpgProgress(currentEpg.now.startMs, currentEpg.now.stopMs)
      : 0;

  // Dynamic sizing classes controlled by Ayarlar -> Kontrol İkon Boyutu
  const iconSizeCls =
    controlsSize === 'xlarge'
      ? 'w-6 h-6 sm:w-7 sm:h-7'
      : controlsSize === 'large'
      ? 'w-5 h-5 sm:w-6 sm:h-6'
      : 'w-4 h-4 sm:w-5 sm:h-5';

  const playIconCls =
    controlsSize === 'xlarge'
      ? 'w-7 h-7 sm:w-8 sm:h-8'
      : controlsSize === 'large'
      ? 'w-6 h-6 sm:w-7 sm:h-7'
      : 'w-5 h-5 sm:w-6 sm:h-6';

  const btnPadCls =
    controlsSize === 'xlarge'
      ? 'p-2.5 sm:p-3 rounded-2xl'
      : controlsSize === 'large'
      ? 'p-2 sm:p-2.5 rounded-xl'
      : 'p-1.5 sm:p-2 rounded-xl';

  const playBtnCls =
    controlsSize === 'xlarge'
      ? 'w-14 h-14 sm:w-16 sm:h-16 rounded-2xl'
      : controlsSize === 'large'
      ? 'w-12 h-12 sm:w-14 sm:h-14 rounded-2xl'
      : 'w-10 h-10 sm:w-11 sm:h-11 rounded-xl';

  const frameCls = highContrastControls
    ? 'bg-black/75 border border-white/25 shadow-lg backdrop-blur-sm hover:border-[var(--accent)] hover:bg-black/90'
    : 'bg-black/35 hover:bg-white/20';

  return (
    <div
      ref={containerRef}
      onMouseMove={resetHudTimer}
      onClick={() => {
        if (isFullscreen && !drawerOpen) {
          setHudVisible((v) => !v);
          resetHudTimer();
        }
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={`relative bg-black overflow-hidden select-none ${
        isFullscreen
          ? 'fixed inset-0 z-50 w-screen h-dvh'
          : 'w-full aspect-video rounded-none'
      }`}
    >
      <video
        ref={videoRef}
        playsInline
        onLoadedMetadata={(e) => {
          const vid = e.currentTarget;
          if (Number.isFinite(vid.duration) && vid.duration > 0) {
            setVodDuration(vid.duration);
            if (
              currentChannel?.isVod &&
              !didResumeSeekRef.current &&
              vodResumeTime > 10 &&
              vodResumeTime < vid.duration - 10
            ) {
              didResumeSeekRef.current = true;
              vid.currentTime = vodResumeTime;
              setVodTime(vodResumeTime);
            }
          }
        }}
        onTimeUpdate={(e) => {
          const vid = e.currentTarget;
          if (!currentChannel?.isVod) return;
          if (Number.isFinite(vid.duration) && vid.duration > 0) {
            setVodTime(vid.currentTime);
            setVodDuration(vid.duration);
            const nowSec = Math.floor(vid.currentTime);
            if (
              onVodProgress &&
              Math.abs(nowSec - lastSavedTickRef.current) >= 3
            ) {
              lastSavedTickRef.current = nowSec;
              onVodProgress(currentChannel.id, vid.currentTime, vid.duration);
            }
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
          setPlayerError(null);
        }}
        onPause={() => setIsPlaying(false)}
        onCanPlay={() => setIsBuffering(false)}
        onError={() => {
          if (currentChannel) {
            setIsBuffering(false);
            setPlayerError('Yayın bağlanamadı. Alternatif yayını deneyin.');
          }
        }}
        className={`w-full h-full bg-black ${objectFitClass}`}
      />

      {currentChannel?.isRadio && !playerError && (
        <RadioVisualizerOverlay
          channel={currentChannel}
          isPlaying={isPlaying}
          effectMode={radioEffectMode}
          intensity={radioEffectIntensity}
          showLogo={radioShowLogo}
          backgroundImage={radioBackgroundImage}
        />
      )}

      {/* Seek Toast Indicator */}
      {seekToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-xl bg-black/85 border border-[var(--accent)] text-white text-xs font-extrabold shadow-xl pointer-events-none">
          {seekToast}
        </div>
      )}

      {/* Top OSD Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-2 px-3 py-2.5 bg-gradient-to-b from-black/90 via-black/55 to-transparent transition-opacity duration-200 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white font-bold text-[13px] sm:text-sm truncate drop-shadow">
              {currentChannel?.name ?? 'Kanal Seçiniz'}
            </span>
            {currentChannel && (
              <span className="text-[var(--live)] text-[10px] font-extrabold tracking-wider uppercase shrink-0">
                {currentChannel.isVod ? 'FİLM / DİZİ' : 'CANLI'}
              </span>
            )}
          </div>
          {currentChannel && (
            <div className="text-[var(--accent)] text-[11px] font-semibold truncate">
              {currentChannel.smartCategory}
              {currentEpg?.now && (
                <span className="text-white/90 font-normal ml-1.5">
                  · {currentEpg.now.title}{' '}
                  <span className="font-mono-nums text-white/75">
                    ({formatEpgTime(currentEpg.now.startMs)}–
                    {formatEpgTime(currentEpg.now.stopMs)})
                  </span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onEnableMultiScreen && (
            <button
              type="button"
              onClick={onEnableMultiScreen}
              title="Çoklu Ekran Modu (2'li / 4'lü)"
              className={`${btnPadCls} ${frameCls} text-[var(--accent)] transition-colors focus:outline-none`}
            >
              <LayoutGrid className={iconSizeCls} />
            </button>
          )}
          {onOpenEpg && currentChannel && !currentChannel.isRadio && (
            <button
              type="button"
              onClick={onOpenEpg}
              title="Yayın Akışı (EPG)"
              className={`${btnPadCls} ${frameCls} text-[var(--accent)] transition-colors focus:outline-none`}
            >
              <CalendarClock className={iconSizeCls} />
            </button>
          )}
          <button
            type="button"
            onClick={onToggleAspect}
            title={`En Boy Oranı: ${aspectLabel}`}
            className={`${btnPadCls} ${frameCls} text-white transition-colors focus:outline-none`}
          >
            <Ratio className={iconSizeCls} />
          </button>
          <button
            type="button"
            onClick={toggleMute}
            title={isMuted ? 'Sesi Aç' : 'Sessiz'}
            className={`${btnPadCls} ${frameCls} text-white transition-colors focus:outline-none`}
          >
            {isMuted ? (
              <VolumeX className={`${iconSizeCls} text-[var(--accent)]`} />
            ) : (
              <Volume2 className={iconSizeCls} />
            )}
          </button>
        </div>
      </div>

      {/* Unmute Prompt if browser blocked autoplay audio */}
      {needsUnmutePrompt && !playerError && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleMute();
          }}
          className="absolute bottom-20 right-3 z-25 flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-extrabold shadow-xl hover:bg-[var(--accent-hover)] focus:outline-none"
        >
          <Volume2 className="w-5 h-5" />
          <span>Sesi Aç</span>
        </button>
      )}

      {/* Buffering Spinner */}
      {isBuffering && !playerError && (
        <div className="absolute inset-0 z-15 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 rounded-full border-4 border-[var(--accent)]/25 border-t-[var(--accent)] animate-spin" />
        </div>
      )}

      {/* Error Overlay */}
      {playerError && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 z-25 flex items-center justify-center p-4 pointer-events-none"
        >
          <div className="pointer-events-auto flex flex-col items-center text-center bg-black/85 border border-[var(--border)] rounded-xl p-4 max-w-xs">
            <div className="text-[var(--live)] text-xs font-medium">{playerError}</div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRetryCount((c) => c + 1)}
                className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold hover:bg-[var(--accent-hover)]"
              >
                Tekrar Dene
              </button>
              <button
                type="button"
                onClick={onNext}
                className="px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-white text-xs font-semibold hover:border-[var(--accent)]"
              >
                Sonraki Kanal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Large Bottom Transport & Fullscreen Control Dock (Normal + Fullscreen) */}
      {!drawerOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute bottom-0 inset-x-0 z-20 px-3 sm:px-4 pt-6 pb-2.5 sm:pb-3 bg-gradient-to-t from-black/95 via-black/70 to-transparent space-y-2 transition-opacity duration-200 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* VOD Seek Scrub Bar */}
          {currentChannel?.isVod && vodDuration > 0 && (
            <div className="flex items-center gap-2.5">
              <span className="font-mono-nums text-xs font-bold text-white shrink-0">
                {Math.floor(vodTime / 60)}:{String(Math.floor(vodTime % 60)).padStart(2, '0')}
              </span>
              <input
                type="range"
                min={0}
                max={Math.floor(vodDuration)}
                value={Math.floor(vodTime)}
                onChange={(e) => {
                  const targetSec = Number(e.target.value);
                  if (videoRef.current) {
                    videoRef.current.currentTime = targetSec;
                    setVodTime(targetSec);
                  }
                }}
                className="flex-1 h-2 accent-[var(--accent)] cursor-pointer"
              />
              <span className="font-mono-nums text-xs font-bold text-white/80 shrink-0">
                {Math.floor(vodDuration / 60)}:{String(Math.floor(vodDuration % 60)).padStart(2, '0')}
              </span>
            </div>
          )}

          {/* Fullscreen EPG Progress */}
          {isFullscreen && !currentChannel?.isVod && currentEpg?.now && (
            <div className="max-w-xl space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs text-white">
                <span className="font-semibold truncate">
                  Şimdi: {currentEpg.now.title}
                </span>
                {currentEpg.next && (
                  <span className="text-white/75 truncate shrink-0">
                    Sonraki: {currentEpg.next.title}
                  </span>
                )}
              </div>
              <div className="h-1.5 w-full rounded bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)]"
                  style={{ width: `${currentProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Main Visible Large Transport Row */}
          <div className="flex items-center justify-between gap-2">
            {/* Left: Channel List (Fullscreen) or Previous Channel */}
            <div className="flex items-center gap-1.5">
              {isFullscreen ? (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-black/80 border border-[var(--accent)]/70 text-white text-xs sm:text-sm font-bold hover:bg-black`}
                >
                  <List className={`${iconSizeCls} text-[var(--accent)]`} />
                  <span className="hidden sm:inline">
                    Kanallar (<span className="font-mono-nums">{channels.length}</span>)
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPrev}
                  title="Önceki Kanal"
                  className={`${btnPadCls} ${frameCls} text-white transition-colors focus:outline-none`}
                >
                  <SkipBack className={iconSizeCls} />
                </button>
              )}
            </div>

            {/* Center: Rewind + BIG Play/Pause + Fast Forward */}
            <div className="flex items-center gap-2 sm:gap-3">
              {isFullscreen && (
                <button
                  type="button"
                  onClick={onPrev}
                  title="Önceki Kanal"
                  className={`${btnPadCls} ${frameCls} text-white transition-colors focus:outline-none`}
                >
                  <SkipBack className={iconSizeCls} />
                </button>
              )}

              <button
                type="button"
                onClick={() => seekBySeconds(-seekStepSeconds)}
                title={`${seekStepSeconds} saniye geri sar`}
                className={`${btnPadCls} ${frameCls} text-white flex items-center gap-1 transition-colors focus:outline-none`}
              >
                <RotateCcw className={iconSizeCls} />
                <span className="font-mono-nums text-[11px] sm:text-xs font-extrabold text-[var(--accent)]">
                  -{seekStepSeconds}
                </span>
              </button>

              <button
                type="button"
                onClick={togglePlayPause}
                title={isPlaying ? 'Duraklat' : 'Oynat'}
                className={`${playBtnCls} bg-[var(--accent)] text-[var(--accent-ink)] shadow-xl flex items-center justify-center hover:bg-[var(--accent-hover)] transition-transform active:scale-95 focus:outline-none`}
              >
                {isPlaying ? (
                  <Pause className={playIconCls} />
                ) : (
                  <Play className={`${playIconCls} translate-x-0.5`} />
                )}
              </button>

              <button
                type="button"
                onClick={() => seekBySeconds(seekStepSeconds)}
                title={`${seekStepSeconds} saniye ileri sar`}
                className={`${btnPadCls} ${frameCls} text-white flex items-center gap-1 transition-colors focus:outline-none`}
              >
                <span className="font-mono-nums text-[11px] sm:text-xs font-extrabold text-[var(--accent)]">
                  +{seekStepSeconds}
                </span>
                <RotateCw className={iconSizeCls} />
              </button>

              <button
                type="button"
                onClick={onNext}
                title="Sonraki Kanal"
                className={`${btnPadCls} ${frameCls} text-white transition-colors focus:outline-none`}
              >
                <SkipForward className={iconSizeCls} />
              </button>
            </div>

            {/* Right: BIG Prominent Fullscreen Toggle */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onToggleFullscreen(!isFullscreen)}
                title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
                className={`${btnPadCls} bg-black/85 border-2 border-[var(--accent)] text-[var(--accent)] shadow-xl hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors focus:outline-none`}
              >
                {isFullscreen ? (
                  <Minimize className={iconSizeCls} />
                ) : (
                  <Maximize className={iconSizeCls} />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Overlay Channel List Drawer (Mi Box & Android Phone) */}
      {isFullscreen && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          className="absolute inset-0 z-30 bg-black/55 flex"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[86vw] max-w-sm h-full bg-[var(--bg)]/95 backdrop-blur-md border-r border-[var(--border)] flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-3.5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <div>
                <div className="text-sm font-bold text-[var(--ink)]">
                  Kanal Listesi (<span className="font-mono-nums">{channels.length}</span>)
                </div>
                <div className="text-[11px] text-[var(--muted)]">
                  Yukarı/Aşağı: Seç · Sağ Ok: Kategori · Enter: İzle
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-2.5 border-b border-[var(--border)] space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-[var(--accent)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Kanal veya radyo ara..."
                  className="w-full rounded-xl bg-[var(--surface)] border border-[var(--border)] pl-9 pr-8 py-2 text-xs text-[var(--ink)] placeholder-[var(--muted)]/60 focus:outline-none focus:border-[var(--accent)]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => onSearchChange('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--ink)]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {visibleCategories.map((cat) => {
                  const selected = cat === selectedCategory;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => onSelectCategory(cat)}
                      className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] transition-colors focus:outline-none ${
                        selected
                          ? 'bg-[var(--accent)] text-[var(--accent-ink)] font-bold'
                          : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              ref={drawerListRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (
                  el.scrollHeight - el.scrollTop - el.clientHeight < 250 &&
                  drawerLimit < channels.length
                ) {
                  setDrawerLimit((prev) => Math.min(prev + 80, channels.length));
                }
              }}
              className="flex-1 overflow-y-auto p-2.5 space-y-2"
            >
              {channels.slice(0, drawerLimit).map((ch, idx) => (
                <ChannelRowItem
                  key={ch.id}
                  channel={ch}
                  compact
                  epgNow={lookupEpgForChannel(epgMap, ch.name)?.now?.title ?? null}
                  isPlaying={currentChannel?.id === ch.id}
                  isFavorite={favoriteIds.has(ch.name)}
                  isFocused={idx === focusedIndex}
                  onSelect={() => {
                    setFocusedIndex(idx);
                    onSelectChannel(ch);
                  }}
                  onToggleFavorite={() => onToggleFavorite(ch)}
                />
              ))}
              {channels.length === 0 && (
                <div className="py-10 text-center text-xs text-[var(--muted)]">
                  Bu filtrede kanal bulunamadı.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
