import { useEffect, useRef, useState, useCallback, type TouchEvent } from 'react';
import Hls from 'hls.js';
import {
  AudioLines,
  CalendarClock,
  Captions,
  Heart,
  LayoutGrid,
  List,
  Maximize,
  Minimize,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
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
  Zap,
} from 'lucide-react';
import type {
  AspectMode,
  BufferPreset,
  CategoryName,
  Channel,
  EpgNowNext,
  PlayerControlsSize,
  RadioEffectIntensity,
  RadioEffectMode,
} from '../types/channel';
import { computeEpgProgress, formatEpgTime, lookupEpgForChannel } from '../utils/epg';
import { buildHlsConfig, getHlsProfileSummary } from '../utils/hlsConfig';
import {
  getChannelPerfKey,
  type ChannelPerfEvent,
  type ChannelPerfStats,
} from '../utils/channelPerformance';
import { RadioVisualizerOverlay } from './RadioVisualizerOverlay';
import { ChannelRowItem } from './ChannelRowItem';
import { useIdleAutoClose } from '../hooks/useIdleAutoClose';
import { logAppError } from '../utils/errorLogger';

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
  menuAutoCloseSeconds?: number;
  bufferPreset?: BufferPreset;
  controlsSize?: PlayerControlsSize;
  highContrastControls?: boolean;
  seekStepSeconds?: number;
  radioEffectMode?: RadioEffectMode;
  radioEffectIntensity?: RadioEffectIntensity;
  radioShowLogo?: boolean;
  radioBackgroundImage?: string;
  epgMap?: Record<string, EpgNowNext>;
  vodResumeTime?: number;
  lowRamMode?: boolean;
  acceleratedPlaybackMode?: boolean;
  onToggleAcceleratedMode?: () => void;
  onVodProgress?: (channelId: string, currentTime: number, duration: number) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onSelectChannel: (channel: Channel) => void;
  onSelectCategory: (cat: CategoryName) => void;
  onSearchChange: (q: string) => void;
  onToggleFavorite: (channel: Channel) => void;
  onToggleFullscreen: (enable: boolean) => void;
  onToggleAspect: () => void;
  onEnableMultiScreen?: () => void;
  onOpenEpg?: () => void;
  isSidePanelOpen?: boolean;
  onToggleSidePanel?: () => void;
  isLeftVodOpen?: boolean;
  onToggleLeftVod?: () => void;
  perfMap?: Record<string, ChannelPerfStats>;
  onChannelPerfEvent?: (channel: Channel, event: ChannelPerfEvent) => void;
  onPrev: () => void;
  onNext: () => void;
}

function isBackKey(e: KeyboardEvent): boolean {
  return (
    e.key === 'Escape' ||
    e.key === 'GoBack' ||
    e.key === 'BrowserBack' ||
    e.key === 'Back' ||
    e.key === 'Backspace' ||
    e.keyCode === 4 ||
    e.keyCode === 461
  );
}

function isSelectKey(e: KeyboardEvent): boolean {
  return (
    e.key === 'Enter' ||
    e.key === 'NumpadEnter' ||
    e.key === 'Select' ||
    e.key === 'DPadCenter'
  );
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
  hudHideSeconds = 5,
  menuAutoCloseSeconds = 5,
  bufferPreset = 'balanced',
  controlsSize = 'large',
  highContrastControls = true,
  seekStepSeconds = 15,
  radioEffectMode = 'aurora',
  radioEffectIntensity = 'vivid',
  radioShowLogo = true,
  radioBackgroundImage = '',
  epgMap = {},
  vodResumeTime = 0,
  lowRamMode = true,
  acceleratedPlaybackMode = true,
  onToggleAcceleratedMode,
  onVodProgress,
  onPlaybackStateChange,
  onSelectChannel,
  onSelectCategory,
  onSearchChange,
  onToggleFavorite,
  onToggleFullscreen,
  onToggleAspect,
  onEnableMultiScreen,
  onOpenEpg,
  isSidePanelOpen = true,
  onToggleSidePanel,
  isLeftVodOpen = true,
  onToggleLeftVod,
  perfMap = {},
  onChannelPerfEvent,
  onPrev,
  onNext,
}: VideoPlayerSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const drawerListRef = useRef<HTMLDivElement | null>(null);
  const drawerCatsRef = useRef<HTMLDivElement | null>(null);
  const drawerQuickTabsRef = useRef<HTMLDivElement | null>(null);
  const drawerSearchRef = useRef<HTMLInputElement | null>(null);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const bottomBarRef = useRef<HTMLDivElement | null>(null);
  const playBtnRef = useRef<HTMLButtonElement | null>(null);

  const [isBuffering, setIsBuffering] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('eymen_player_volume_v1'));
      return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 1;
    } catch {
      return 1;
    }
  });
  const [needsUnmutePrompt, setNeedsUnmutePrompt] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [streamAttemptIdx, setStreamAttemptIdx] = useState(0);
  const [audioTracks, setAudioTracks] = useState<Array<{ id: number; name: string }>>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number>(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{ id: number; name: string }>>([]);
  const [activeSubtitleTrack, setActiveSubtitleTrack] = useState<number>(-1);
  const [vodTime, setVodTime] = useState(0);
  const [vodDuration, setVodDuration] = useState(0);
  const [seekToast, setSeekToast] = useState<string | null>(null);
  const lastSavedTickRef = useRef(0);
  const didResumeSeekRef = useRef(false);
  const seekToastTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; x: number } | null>(null);
  const prevChannelIdRef = useRef<string | null>(null);

  // Channel performance tracking refs (per tune attempt)
  const loadStartTimeRef = useRef<number>(0);
  const reportedStartupRef = useRef<boolean>(false);
  const reportedErrorForAttemptRef = useRef<boolean>(false);
  const lastStallReportRef = useRef<number>(0);
  const onChannelPerfRef = useRef(onChannelPerfEvent);
  onChannelPerfRef.current = onChannelPerfEvent;

  // Fullscreen & Normal Mode HUD + Channel List Drawer state (5s auto-hide/close)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const prevDrawerOpenRef = useRef(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [drawerLimit, setDrawerLimit] = useState(80);
  const hudTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastTouchTimeRef = useRef<number>(0);
  const didSwipeRef = useRef<boolean>(false);
  const onPrevRef = useRef(onPrev);
  onPrevRef.current = onPrev;
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  const acceleratedModeRef = useRef(acceleratedPlaybackMode);
  acceleratedModeRef.current = acceleratedPlaybackMode;
  const bufferPresetRef = useRef(bufferPreset);
  bufferPresetRef.current = bufferPreset;
  const lowRamModeRef = useRef(lowRamMode);
  lowRamModeRef.current = lowRamMode;

  const isVodMode = Boolean(currentChannel?.isVod);

  useEffect(() => {
    onPlaybackStateChange?.(isPlaying);
  }, [isPlaying, onPlaybackStateChange]);

  // Auto-close fullscreen channel drawer after menuAutoCloseSeconds (5s) of no interaction
  useIdleAutoClose(
    isFullscreen && drawerOpen,
    menuAutoCloseSeconds,
    () => {
      setDrawerOpen(false);
    },
    false,
    true
  );

  const resetHudTimer = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current !== null) {
      window.clearTimeout(hudTimerRef.current);
      hudTimerRef.current = null;
    }
    const shouldAutoHide =
      (isFullscreen || isPlaying) && !drawerOpen && !playerError;
    if (shouldAutoHide) {
      const waitSec = Math.max(2, hudHideSeconds);
      hudTimerRef.current = window.setTimeout(() => {
        setHudVisible(false);
      }, waitSec * 1000);
    }
  }, [isFullscreen, isPlaying, drawerOpen, playerError, hudHideSeconds]);

  useEffect(() => {
    if (!isFullscreen) setDrawerOpen(false);
    if (!isFullscreen && !isPlaying) {
      setHudVisible(true);
      if (hudTimerRef.current !== null) {
        window.clearTimeout(hudTimerRef.current);
      }
    } else {
      resetHudTimer();
    }
  }, [isFullscreen, isPlaying, resetHudTimer]);

  useEffect(() => {
    setDrawerLimit(80);
  }, [selectedCategory, searchQuery]);

  // Focus active channel when Fullscreen Drawer opens & restore Play focus when it closes
  useEffect(() => {
    const wasOpen = prevDrawerOpenRef.current;
    prevDrawerOpenRef.current = drawerOpen;
    if (!drawerOpen) {
      if (wasOpen && isFullscreen) {
        setHudVisible(true);
        const restoreId = window.setTimeout(() => {
          playBtnRef.current?.focus();
        }, 40);
        return () => window.clearTimeout(restoreId);
      }
      return;
    }
    const id = window.setTimeout(() => {
      if (currentChannel) {
        const idx = channels.findIndex((c) => c.id === currentChannel.id);
        if (idx >= drawerLimit) {
          setDrawerLimit(idx + 40);
        }
        const el = drawerListRef.current?.querySelector<HTMLElement>(
          `[data-channel-id="${CSS.escape(currentChannel.id)}"]`
        );
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          el.focus();
          return;
        }
      }
      const firstEl = drawerListRef.current?.querySelector<HTMLElement>('[data-channel-id]');
      firstEl?.focus();
    }, 60);
    return () => window.clearTimeout(id);
  }, [drawerOpen, isFullscreen, currentChannel, channels, drawerLimit]);

  useEffect(() => {
    if (pauseSignal > 0 && videoRef.current) {
      videoRef.current.pause();
    }
  }, [pauseSignal]);

  // Reset backup attempt index when switching channels
  useEffect(() => {
    const chId = currentChannel?.id ?? null;
    if (prevChannelIdRef.current !== chId) {
      prevChannelIdRef.current = chId;
      setStreamAttemptIdx(0);
    }
  }, [currentChannel?.id]);

  // Apply persisted volume slider smoothly
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
    }
    try {
      localStorage.setItem('eymen_player_volume_v1', String(volume));
    } catch {
      // ignore
    }
  }, [volume]);

  // Load & play stream via /api/stream proxy (with automatic backupUrls failover)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentChannel) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const candidates = [
      currentChannel.streamUrl,
      ...(currentChannel.backupUrls ?? []),
    ].filter(Boolean);
    const activeUrl =
      candidates[Math.min(streamAttemptIdx, Math.max(0, candidates.length - 1))] ||
      currentChannel.streamUrl;

    setPlayerError(null);
    setIsBuffering(true);
    setNeedsUnmutePrompt(false);
    setAudioTracks([]);
    setActiveAudioTrack(-1);
    setSubtitleTracks([]);
    setActiveSubtitleTrack(-1);
    setVodTime(0);
    setVodDuration(0);
    lastSavedTickRef.current = 0;
    didResumeSeekRef.current = false;

    loadStartTimeRef.current = performance.now();
    reportedStartupRef.current = false;
    reportedErrorForAttemptRef.current = false;
    lastStallReportRef.current = 0;
    onChannelPerfRef.current?.(currentChannel, { type: 'load_start' });

    const params = new URLSearchParams();
    params.set('url', activeUrl);
    if (currentChannel.userAgent) params.set('ua', currentChannel.userAgent);
    if (currentChannel.referer) params.set('referer', currentChannel.referer);
    if (currentChannel.origin) params.set('origin', currentChannel.origin);
    const proxiedUrl = `/api/stream?${params.toString()}`;

    const triggerFailoverOrError = (errorText: string) => {
      if (streamAttemptIdx + 1 < candidates.length) {
        const nextIdx = streamAttemptIdx + 1;
        setSeekToast(
          `Ana yayın yanıt vermedi, yedek kaynağa geçiliyor (${nextIdx + 1}/${candidates.length})`
        );
        if (seekToastTimerRef.current !== null) {
          window.clearTimeout(seekToastTimerRef.current);
        }
        seekToastTimerRef.current = window.setTimeout(() => setSeekToast(null), 2200);
        setStreamAttemptIdx(nextIdx);
        return true;
      }
      setPlayerError(errorText);
      setIsBuffering(false);
      logAppError('player', `${currentChannel.name}: ${errorText}`, activeUrl);
      if (!reportedErrorForAttemptRef.current) {
        reportedErrorForAttemptRef.current = true;
        onChannelPerfRef.current?.(currentChannel, { type: 'error' });
      }
      return false;
    };

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

    const lowerStream = activeUrl.toLowerCase();
    const cleanLower = lowerStream.split('?')[0].split('#')[0];
    const looksLikeHls =
      cleanLower.endsWith('.m3u8') ||
      cleanLower.endsWith('.m3u') ||
      lowerStream.includes('.m3u8') ||
      lowerStream.includes('/hls/') ||
      lowerStream.includes('workers.dev') ||
      currentChannel.codec === 'HLS';
    const isKnownDirectFile =
      /\.(mp4|mkv|webm|mov|avi|mp3|aac|ogg|flac|wav|opus|ts)$/i.test(cleanLower);
    const isDirectStream =
      (currentChannel.isRadio && !looksLikeHls) ||
      (Boolean(currentChannel.isVod) && !looksLikeHls) ||
      (isKnownDirectFile && !looksLikeHls);

    const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';

    let netRecoverAttempts = 0;
    let stallCount = 0;
    let recoveryTimer: number | null = null;
    const maxNetRetries = acceleratedModeRef.current ? 4 : 3;

    if (isDirectStream) {
      video.src = proxiedUrl;
      void attemptPlay();
    } else if (Hls.isSupported()) {
      const hls = new Hls(
        buildHlsConfig({
          acceleratedPlaybackMode: acceleratedModeRef.current,
          bufferPreset: bufferPresetRef.current,
          lowRamMode: lowRamModeRef.current,
          isMultiScreen: false,
        })
      );
      hlsRef.current = hls;

      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);

      const syncTracks = () => {
        const aTracks = (hls.audioTracks || []).map((t, i) => ({
          id: i,
          name: t.name || t.lang?.toUpperCase() || `Ses ${i + 1}`,
        }));
        setAudioTracks(aTracks);
        setActiveAudioTrack(hls.audioTrack);

        const sTracks = (hls.subtitleTracks || []).map((t, i) => ({
          id: i,
          name: t.name || t.lang?.toUpperCase() || `Altyazı ${i + 1}`,
        }));
        setSubtitleTracks(sTracks);
        setActiveSubtitleTrack(hls.subtitleTrack);
      };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerError(null);
        netRecoverAttempts = 0;
        syncTracks();
        void attemptPlay();
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, syncTracks);
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, syncTracks);

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        stallCount = 0;
        setIsBuffering(false);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            setIsBuffering(true);
            stallCount++;
            const nowTs = Date.now();
            if (
              reportedStartupRef.current &&
              nowTs - lastStallReportRef.current >= 4500
            ) {
              lastStallReportRef.current = nowTs;
              onChannelPerfRef.current?.(currentChannel, { type: 'stall' });
            }
            if (stallCount >= 2 && hls.levels.length > 1) {
              hls.nextLevel = 0;
            }
            if (video.buffered.length > 0 && !video.paused) {
              try {
                const end = video.buffered.end(video.buffered.length - 1);
                if (end - video.currentTime > 0.4) {
                  video.currentTime += 0.15;
                }
              } catch {
                // ignore seek nudge errors
              }
            }
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
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (currentChannel.isRadio) {
            hls.destroy();
            hlsRef.current = null;
            video.src = proxiedUrl;
            void attemptPlay();
            return;
          }
          if (netRecoverAttempts < maxNetRetries) {
            netRecoverAttempts++;
            setIsBuffering(true);
            if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
            recoveryTimer = window.setTimeout(() => {
              if (hlsRef.current === hls) {
                hls.startLoad();
              }
            }, netRecoverAttempts * (acceleratedModeRef.current ? 650 : 900));
            return;
          }
          hls.destroy();
          triggerFailoverOrError('Yayın bağlanamadı (Ağ hatası). Alternatif yayını deneyin.');
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          hls.destroy();
          triggerFailoverOrError('Yayın bağlanamadı. Alternatif yayını deneyin.');
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
        artist: `${currentChannel.smartCategory} · ${currentChannel.isVod ? 'FİLM / DİZİ' : 'CANLI'}`,
        album: 'Eymen TV & Radyo',
        artwork: currentChannel.logoUrl
          ? [
              {
                src: `/api/logo?url=${encodeURIComponent(
                  currentChannel.logoUrl
                )}&name=${encodeURIComponent(currentChannel.name)}${
                  currentChannel.isRadio ? '&radio=1' : ''
                }`,
                sizes: '256x256',
                type: 'image/png',
              },
            ]
          : [
              {
                src: `/api/logo?name=${encodeURIComponent(currentChannel.name)}${
                  currentChannel.isRadio ? '&radio=1' : ''
                }`,
                sizes: '256x256',
                type: 'image/png',
              },
            ],
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => onPrevRef.current());
      navigator.mediaSession.setActionHandler('nexttrack', () => onNextRef.current());
      navigator.mediaSession.setActionHandler('play', () => void video.play());
      navigator.mediaSession.setActionHandler('pause', () => video.pause());
    }

    return () => {
      if (recoveryTimer !== null) {
        window.clearTimeout(recoveryTimer);
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [currentChannel, retryCount, streamAttemptIdx]);

  // Dynamically update active HLS buffer & ABR parameters when Accelerated Mode or Buffer Preset toggles
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    const nextCfg = buildHlsConfig({
      acceleratedPlaybackMode,
      bufferPreset,
      lowRamMode,
      isMultiScreen: false,
    });
    Object.assign(hls.config, nextCfg);
  }, [acceleratedPlaybackMode, bufferPreset, lowRamMode]);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
    resetHudTimer();
  }, [resetHudTimer]);

  const seekBySeconds = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const seekable = video.seekable;
      let minT = 0;
      let maxT =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : video.currentTime;
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
    },
    [resetHudTimer]
  );

  // Keyboard / Mi Box TV Remote navigation
  useEffect(() => {
    const moveFocusInRow = (container: HTMLElement | null, dir: -1 | 0 | 1): boolean => {
      if (!container) return false;
      const buttons = Array.from(
        container.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
      );
      if (buttons.length === 0) return false;
      const idx = buttons.indexOf(document.activeElement as HTMLElement);
      if (idx === -1) {
        buttons[0].focus();
        return true;
      }
      const nextIdx = Math.max(0, Math.min(buttons.length - 1, idx + dir));
      buttons[nextIdx].focus();
      return true;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable) &&
        (target as HTMLInputElement).type !== 'range';

      // Global TV Media & Channel keys (work in both normal & fullscreen)
      if (e.key === 'MediaTrackNext' || e.key === 'ChannelUp' || e.key === 'F9') {
        e.preventDefault();
        onNext();
        resetHudTimer();
        return;
      }
      if (e.key === 'MediaTrackPrevious' || e.key === 'ChannelDown' || e.key === 'F10') {
        e.preventDefault();
        onPrev();
        resetHudTimer();
        return;
      }
      if (
        e.key === 'MediaPlayPause' ||
        e.key === 'MediaPlay' ||
        e.key === 'MediaPause'
      ) {
        e.preventDefault();
        const video = videoRef.current;
        if (video) {
          if (e.key === 'MediaPlay') void video.play();
          else if (e.key === 'MediaPause') video.pause();
          else togglePlayPause();
        }
        return;
      }
      if (e.key === 'MediaFastForward') {
        e.preventDefault();
        seekBySeconds(seekStepSeconds);
        return;
      }
      if (e.key === 'MediaRewind') {
        e.preventDefault();
        seekBySeconds(-seekStepSeconds);
        return;
      }

      if (isTyping) {
        if (isBackKey(e) && drawerOpen) {
          e.preventDefault();
          e.stopPropagation();
          setDrawerOpen(false);
        } else if (e.key === 'ArrowDown' && drawerOpen) {
          e.preventDefault();
          const firstRow = drawerListRef.current?.querySelector<HTMLElement>('[data-channel-id]');
          firstRow?.focus();
        }
        return;
      }

      if (!isFullscreen) {
        if ((e.key === 'f' || e.key === 'F') && currentChannel) {
          e.preventDefault();
          onToggleFullscreen(true);
        }
        return;
      }

      // Fullscreen Mi Box TV Remote Navigation
      resetHudTimer();

      if (isBackKey(e)) {
        e.preventDefault();
        e.stopPropagation();
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
        e.key === 'ContextMenu' ||
        e.key === 'Guide'
      ) {
        e.preventDefault();
        setDrawerOpen((prev) => !prev);
        return;
      }

      if (drawerOpen) {
        const active = document.activeElement as HTMLElement | null;
        const rows = Array.from(
          drawerListRef.current?.querySelectorAll<HTMLElement>('[data-channel-id]') ?? []
        );
        const rowIdx = active ? rows.indexOf(active) : -1;
        const inQuickTabs = Boolean(active && drawerQuickTabsRef.current?.contains(active));
        const inCatBar = Boolean(active && drawerCatsRef.current?.contains(active));

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (inQuickTabs) {
            const firstCat =
              drawerCatsRef.current?.querySelector<HTMLElement>('[data-selected="true"]') ??
              drawerCatsRef.current?.querySelector<HTMLElement>('button');
            if (firstCat) firstCat.focus();
            else rows[0]?.focus();
          } else if (inCatBar || rowIdx === -1) {
            rows[0]?.focus();
            rows[0]?.scrollIntoView({ block: 'nearest' });
          } else {
            const nextIdx = Math.min(rowIdx + 1, rows.length - 1);
            if (nextIdx >= rows.length - 6 && drawerLimit < channels.length) {
              setDrawerLimit((l) => Math.min(l + 60, channels.length));
            }
            const targetRow = rows[nextIdx];
            targetRow?.focus();
            targetRow?.scrollIntoView({ block: 'nearest' });
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (rowIdx > 0) {
            const prevRow = rows[rowIdx - 1];
            prevRow?.focus();
            prevRow?.scrollIntoView({ block: 'nearest' });
          } else if (rowIdx === 0) {
            const activeCat =
              drawerCatsRef.current?.querySelector<HTMLElement>('[data-selected="true"]') ??
              drawerCatsRef.current?.querySelector<HTMLElement>('button') ??
              drawerQuickTabsRef.current?.querySelector<HTMLElement>('button');
            activeCat?.focus();
          } else if (inCatBar) {
            const activeQuick =
              drawerQuickTabsRef.current?.querySelector<HTMLElement>('[data-selected="true"]') ??
              drawerQuickTabsRef.current?.querySelector<HTMLElement>('button');
            activeQuick?.focus();
          } else if (inQuickTabs) {
            drawerSearchRef.current?.focus();
          }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (inQuickTabs) {
            moveFocusInRow(drawerQuickTabsRef.current, -1);
          } else if (inCatBar) {
            moveFocusInRow(drawerCatsRef.current, -1);
          } else {
            setDrawerOpen(false);
          }
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (inQuickTabs) {
            moveFocusInRow(drawerQuickTabsRef.current, 1);
          } else if (inCatBar) {
            moveFocusInRow(drawerCatsRef.current, 1);
          } else if (visibleCategories.length > 0) {
            const idx = visibleCategories.indexOf(selectedCategory);
            const nextCat =
              visibleCategories[(idx + 1) % visibleCategories.length];
            onSelectCategory(nextCat);
          }
        } else if (isSelectKey(e) && active && !containerRef.current?.contains(active)) {
          e.preventDefault();
          rows[0]?.focus();
        }
        return;
      }

      // Fullscreen Video Mode (drawer closed)
      const active = document.activeElement as HTMLElement | null;
      const isInTopBar = Boolean(active && topBarRef.current?.contains(active));
      const isInBottomBar = Boolean(active && bottomBarRef.current?.contains(active));

      if (isInTopBar || isInBottomBar) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          moveFocusInRow(isInTopBar ? topBarRef.current : bottomBarRef.current, -1);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          moveFocusInRow(isInTopBar ? topBarRef.current : bottomBarRef.current, 1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (isInBottomBar) {
            moveFocusInRow(topBarRef.current, 0);
          } else {
            (active as HTMLElement)?.blur();
            setHudVisible(false);
          }
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (isInTopBar) {
            if (playBtnRef.current) {
              playBtnRef.current.focus();
            } else {
              moveFocusInRow(bottomBarRef.current, 0);
            }
          } else {
            (active as HTMLElement)?.blur();
            setHudVisible(false);
          }
          return;
        }
        if (isSelectKey(e)) {
          if (e.key === 'Select' || e.key === 'DPadCenter') {
            e.preventDefault();
            active?.click();
          }
          return;
        }
      }

      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        if (isVodMode) {
          setHudVisible(true);
          window.setTimeout(() => playBtnRef.current?.focus(), 20);
        } else {
          onPrev();
        }
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        if (isVodMode) {
          setDrawerOpen(true);
        } else {
          onNext();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (isVodMode) {
          seekBySeconds(-seekStepSeconds);
        } else {
          setDrawerOpen(true);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (isVodMode) {
          seekBySeconds(seekStepSeconds);
        } else {
          setHudVisible(true);
          window.setTimeout(() => playBtnRef.current?.focus(), 20);
        }
      } else if (isSelectKey(e)) {
        e.preventDefault();
        if (!hudVisible) {
          setHudVisible(true);
          window.setTimeout(() => playBtnRef.current?.focus(), 20);
        } else {
          togglePlayPause();
        }
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        onToggleFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    isFullscreen,
    isVodMode,
    hudVisible,
    drawerOpen,
    channels,
    drawerLimit,
    currentChannel,
    selectedCategory,
    visibleCategories,
    seekStepSeconds,
    onNext,
    onPrev,
    onSelectCategory,
    onToggleFullscreen,
    resetHudTimer,
    togglePlayPause,
    seekBySeconds,
  ]);

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    if (!video.muted) {
      setNeedsUnmutePrompt(false);
      if (volume === 0) setVolume(0.75);
    }
    resetHudTimer();
  };

  const cycleAudioTrack = () => {
    const hls = hlsRef.current;
    if (!hls || audioTracks.length < 2) return;
    const nextIdx = (activeAudioTrack + 1) % audioTracks.length;
    hls.audioTrack = nextIdx;
    setActiveAudioTrack(nextIdx);
    setSeekToast(`Ses: ${audioTracks[nextIdx]?.name ?? nextIdx + 1}`);
    if (seekToastTimerRef.current !== null) window.clearTimeout(seekToastTimerRef.current);
    seekToastTimerRef.current = window.setTimeout(() => setSeekToast(null), 1600);
    resetHudTimer();
  };

  const cycleSubtitleTrack = () => {
    const hls = hlsRef.current;
    if (!hls || subtitleTracks.length === 0) return;
    const nextIdx = activeSubtitleTrack + 1 >= subtitleTracks.length ? -1 : activeSubtitleTrack + 1;
    hls.subtitleTrack = nextIdx;
    setActiveSubtitleTrack(nextIdx);
    const label = nextIdx === -1 ? 'Kapalı' : subtitleTracks[nextIdx]?.name ?? `${nextIdx + 1}`;
    setSeekToast(`Altyazı: ${label}`);
    if (seekToastTimerRef.current !== null) window.clearTimeout(seekToastTimerRef.current);
    seekToastTimerRef.current = window.setTimeout(() => setSeekToast(null), 1600);
    resetHudTimer();
  };

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    lastTouchTimeRef.current = Date.now();
    didSwipeRef.current = false;
    if (drawerOpen) return;
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    lastTouchTimeRef.current = Date.now();
    if (drawerOpen || !touchStartRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    if (
      Math.abs(t.clientX - touchStartRef.current.x) > 12 ||
      Math.abs(t.clientY - touchStartRef.current.y) > 12
    ) {
      didSwipeRef.current = true;
    }
  };

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    lastTouchTimeRef.current = Date.now();
    if (drawerOpen || !touchStartRef.current) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    // Double-tap seek on VOD (Mobile UX)
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && isVodMode) {
      const now = Date.now();
      const rect = containerRef.current?.getBoundingClientRect();
      if (
        lastTapRef.current &&
        now - lastTapRef.current.time < 300 &&
        rect
      ) {
        const relX = t.clientX - rect.left;
        if (relX < rect.width * 0.4) {
          didSwipeRef.current = true;
          seekBySeconds(-seekStepSeconds);
          lastTapRef.current = null;
          return;
        } else if (relX > rect.width * 0.6) {
          didSwipeRef.current = true;
          seekBySeconds(seekStepSeconds);
          lastTapRef.current = null;
          return;
        }
      }
      lastTapRef.current = { time: now, x: t.clientX };
    }

    if (!isFullscreen) return;

    if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      didSwipeRef.current = true;
      if (dx > 0) {
        setDrawerOpen(true);
      } else if (isVodMode) {
        seekBySeconds(seekStepSeconds);
      } else {
        onNext();
      }
      resetHudTimer();
    } else if (Math.abs(dy) > 65 && Math.abs(dy) > Math.abs(dx) * 1.4) {
      didSwipeRef.current = true;
      if (!isVodMode) {
        if (dy < 0) onNext();
        else onPrev();
        resetHudTimer();
      }
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

  const showControls =
    (!isFullscreen && !isPlaying) ||
    hudVisible ||
    drawerOpen ||
    !!playerError;

  const hlsSummary = getHlsProfileSummary({
    acceleratedPlaybackMode,
    bufferPreset,
    lowRamMode,
    isMultiScreen: false,
  });

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
      onMouseMove={() => {
        if (Date.now() - lastTouchTimeRef.current < 900) return;
        resetHudTimer();
      }}
      onClick={() => {
        if (didSwipeRef.current) {
          didSwipeRef.current = false;
          return;
        }
        if ((isFullscreen || isPlaying || currentChannel) && !drawerOpen) {
          setHudVisible((v) => {
            const next = !v;
            if (next) resetHudTimer();
            return next;
          });
        }
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`relative bg-black overflow-hidden select-none touch-manipulation ${
        isFullscreen
          ? 'fixed inset-0 z-50 w-screen h-dvh'
          : 'w-full h-full rounded-none'
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
        onWaiting={() => {
          setIsBuffering(true);
          const nowTs = Date.now();
          if (
            currentChannel &&
            reportedStartupRef.current &&
            nowTs - lastStallReportRef.current >= 4500
          ) {
            lastStallReportRef.current = nowTs;
            onChannelPerfRef.current?.(currentChannel, { type: 'stall' });
          }
        }}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
          setPlayerError(null);
          if (currentChannel && !reportedStartupRef.current) {
            reportedStartupRef.current = true;
            const startupMs = Math.max(
              50,
              Math.round(performance.now() - loadStartTimeRef.current)
            );
            onChannelPerfRef.current?.(currentChannel, {
              type: 'playing',
              startupMs,
            });
          }
        }}
        onPause={() => setIsPlaying(false)}
        onCanPlay={() => setIsBuffering(false)}
        onError={() => {
          if (currentChannel) {
            const totalBackups = currentChannel.backupUrls?.length ?? 0;
            if (streamAttemptIdx < totalBackups) {
              const nextIdx = streamAttemptIdx + 1;
              setSeekToast(`Yedek kaynağa geçiliyor (${nextIdx + 1}/${totalBackups + 1})`);
              if (seekToastTimerRef.current !== null) {
                window.clearTimeout(seekToastTimerRef.current);
              }
              seekToastTimerRef.current = window.setTimeout(() => setSeekToast(null), 2200);
              setStreamAttemptIdx(nextIdx);
              return;
            }
            setIsBuffering(false);
            const msg = 'Yayın bağlanamadı. Alternatif yayını deneyin.';
            setPlayerError(msg);
            logAppError('player', `${currentChannel.name}: ${msg}`, currentChannel.streamUrl);
            if (!reportedErrorForAttemptRef.current) {
              reportedErrorForAttemptRef.current = true;
              onChannelPerfRef.current?.(currentChannel, { type: 'error' });
            }
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
        ref={topBarRef}
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
          {onToggleAcceleratedMode && (
            <button
              type="button"
              onClick={() => {
                const nextVal = !acceleratedPlaybackMode;
                onToggleAcceleratedMode();
                setSeekToast(
                  nextVal
                    ? 'Hızlandırılmış Oynatma Açıldı (Anti-Donma HLS)'
                    : 'Standart Oynatma Modu'
                );
                if (seekToastTimerRef.current !== null) {
                  window.clearTimeout(seekToastTimerRef.current);
                }
                seekToastTimerRef.current = window.setTimeout(
                  () => setSeekToast(null),
                  1800
                );
                resetHudTimer();
              }}
              title={
                acceleratedPlaybackMode
                  ? 'Hızlandırılmış Oynatma Modu: Açık (Kapatmak için tıkla)'
                  : 'Hızlandırılmış Oynatma Modu: Kapalı (Açmak için tıkla)'
              }
              className={`${btnPadCls} ${
                acceleratedPlaybackMode
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] border border-[var(--accent)] shadow-lg'
                  : `${frameCls} text-white/80`
              } flex items-center gap-1 transition-colors`}
            >
              <Zap className={iconSizeCls} />
              <span className="hidden md:inline text-[11px] font-extrabold">
                {acceleratedPlaybackMode ? 'Hızlı Mod' : 'Normal'}
              </span>
            </button>
          )}
          {onEnableMultiScreen && (
            <button
              type="button"
              onClick={() => {
                resetHudTimer();
                onEnableMultiScreen();
              }}
              title="Çoklu Ekran Modu (2'li / 4'lü)"
              className={`${btnPadCls} ${frameCls} text-[var(--accent)] transition-colors`}
            >
              <LayoutGrid className={iconSizeCls} />
            </button>
          )}
          {onOpenEpg && currentChannel && !currentChannel.isRadio && (
            <button
              type="button"
              onClick={() => {
                resetHudTimer();
                onOpenEpg();
              }}
              title="Yayın Akışı (EPG)"
              className={`${btnPadCls} ${frameCls} text-[var(--accent)] transition-colors`}
            >
              <CalendarClock className={iconSizeCls} />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              resetHudTimer();
              onToggleAspect();
            }}
            title={`En Boy Oranı: ${aspectLabel}`}
            className={`${btnPadCls} ${frameCls} text-white transition-colors`}
          >
            <Ratio className={iconSizeCls} />
          </button>
          {audioTracks.length > 1 && (
            <button
              type="button"
              onClick={cycleAudioTrack}
              title={`Ses Parçası: ${audioTracks[activeAudioTrack]?.name ?? 'Varsayılan'}`}
              className={`${btnPadCls} ${frameCls} flex items-center gap-1 text-[var(--accent)] transition-colors`}
            >
              <AudioLines className={iconSizeCls} />
              <span className="hidden lg:inline text-[11px] font-bold">
                {audioTracks[activeAudioTrack]?.name ?? 'Ses'}
              </span>
            </button>
          )}
          {subtitleTracks.length > 0 && (
            <button
              type="button"
              onClick={cycleSubtitleTrack}
              title={`Altyazı: ${activeSubtitleTrack === -1 ? 'Kapalı' : subtitleTracks[activeSubtitleTrack]?.name ?? 'Açık'}`}
              className={`${btnPadCls} ${
                activeSubtitleTrack >= 0
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] border border-[var(--accent)]'
                  : `${frameCls} text-white`
              } flex items-center gap-1 transition-colors`}
            >
              <Captions className={iconSizeCls} />
            </button>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleMute}
              title={isMuted ? 'Sesi Aç' : 'Sessiz'}
              className={`${btnPadCls} ${frameCls} text-white transition-colors`}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className={`${iconSizeCls} text-[var(--accent)]`} />
              ) : (
                <Volume2 className={iconSizeCls} />
              )}
            </button>
            <input
              type="range"
              aria-label="Ses Seviyesi"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const nextVol = Number(e.target.value);
                setVolume(nextVol);
                if (videoRef.current) {
                  videoRef.current.volume = nextVol;
                  if (nextVol > 0 && videoRef.current.muted) {
                    videoRef.current.muted = false;
                    setIsMuted(false);
                    setNeedsUnmutePrompt(false);
                  }
                }
                resetHudTimer();
              }}
              className="hidden sm:block w-16 md:w-20 h-1.5 accent-[var(--accent)] cursor-pointer"
            />
          </div>
          {!isFullscreen && onToggleLeftVod && (
            <button
              type="button"
              onClick={() => {
                resetHudTimer();
                onToggleLeftVod();
              }}
              title={isLeftVodOpen ? 'Sol Film & Dizi Panelini Gizle' : 'Sol Film & Dizi Panelini Aç'}
              aria-label={isLeftVodOpen ? 'Film & Dizi Gizle' : 'Film & Dizi Aç'}
              className={`hidden md:flex ${btnPadCls} ${frameCls} items-center gap-1.5 text-[var(--accent)] transition-colors whitespace-nowrap`}
            >
              {isLeftVodOpen ? (
                <PanelLeftClose className={iconSizeCls} />
              ) : (
                <PanelLeftOpen className={iconSizeCls} />
              )}
              <span className="hidden lg:inline text-[11px] font-bold">
                Film &amp; Dizi
              </span>
            </button>
          )}
          {!isFullscreen && onToggleSidePanel && (
            <button
              type="button"
              onClick={() => {
                resetHudTimer();
                onToggleSidePanel();
              }}
              title={isSidePanelOpen ? 'Sağ Kanal & Radyo Menüsünü Kapat' : 'Sağ Kanal & Radyo Menüsünü Aç'}
              aria-label={isSidePanelOpen ? 'Sağ Menüyü Kapat' : 'Sağ Menüyü Aç'}
              className={`${btnPadCls} ${frameCls} flex items-center gap-1.5 text-[var(--accent)] transition-colors whitespace-nowrap`}
            >
              {isSidePanelOpen ? (
                <PanelRightClose className={iconSizeCls} />
              ) : (
                <PanelRightOpen className={iconSizeCls} />
              )}
              <span className="hidden lg:inline text-[11px] font-bold">
                Kanallar &amp; Radyo
              </span>
            </button>
          )}
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
          className="absolute bottom-20 right-3 z-25 flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-extrabold shadow-xl hover:bg-[var(--accent-hover)]"
        >
          <Volume2 className="w-5 h-5" />
          <span>Sesi Aç</span>
        </button>
      )}

      {/* Buffering Spinner with Buffer Label */}
      {isBuffering && !playerError && (
        <div className="absolute inset-0 z-15 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <div className="w-12 h-12 rounded-full border-4 border-[var(--accent)]/25 border-t-[var(--accent)] animate-spin" />
          <div className="px-3 py-1 rounded-lg bg-black/75 border border-white/15 text-[11px] font-bold text-[var(--accent)]">
            {acceleratedPlaybackMode
              ? `Hızlandırılmış Tampon (${hlsSummary.maxBufferLength}sn)...`
              : 'Tampon Hazırlanıyor...'}
          </div>
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

      {/* Large Bottom Transport & Fullscreen Control Dock */}
      {!drawerOpen && (
        <div
          ref={bottomBarRef}
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
            <div className="flex items-center gap-1.5">
              {isFullscreen ? (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/80 border border-[var(--accent)]/70 text-white text-xs sm:text-sm font-bold hover:bg-black"
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
                  className={`${btnPadCls} ${frameCls} text-white transition-colors`}
                >
                  <SkipBack className={iconSizeCls} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {isFullscreen && (
                <button
                  type="button"
                  onClick={onPrev}
                  title="Önceki Kanal"
                  className={`${btnPadCls} ${frameCls} text-white transition-colors`}
                >
                  <SkipBack className={iconSizeCls} />
                </button>
              )}

              <button
                type="button"
                onClick={() => seekBySeconds(-seekStepSeconds)}
                title={`${seekStepSeconds} saniye geri sar`}
                className={`${btnPadCls} ${frameCls} text-white flex items-center gap-1 transition-colors`}
              >
                <RotateCcw className={iconSizeCls} />
                <span className="font-mono-nums text-[11px] sm:text-xs font-extrabold text-[var(--accent)]">
                  -{seekStepSeconds}
                </span>
              </button>

              <button
                ref={playBtnRef}
                type="button"
                data-player-play="true"
                onClick={togglePlayPause}
                title={isPlaying ? 'Duraklat' : 'Oynat'}
                className={`${playBtnCls} bg-[var(--accent)] text-[var(--accent-ink)] shadow-xl flex items-center justify-center hover:bg-[var(--accent-hover)] transition-transform active:scale-95`}
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
                className={`${btnPadCls} ${frameCls} text-white flex items-center gap-1 transition-colors`}
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
                className={`${btnPadCls} ${frameCls} text-white transition-colors`}
              >
                <SkipForward className={iconSizeCls} />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onToggleFullscreen(!isFullscreen)}
                title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
                className={`${btnPadCls} bg-black/85 border-2 border-[var(--accent)] text-[var(--accent)] shadow-xl hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors`}
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
                  Yukarı/Aşağı: Seç · OK: İzle · Geri/Sol: Kapat
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
                  ref={drawerSearchRef}
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

              <div ref={drawerQuickTabsRef} className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  data-selected={selectedCategory === 'Tümü' ? 'true' : 'false'}
                  onClick={() => onSelectCategory('Tümü')}
                  className={`touch-compact flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-bold transition-colors ${
                    selectedCategory === 'Tümü'
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  <List className="w-3.5 h-3.5 shrink-0" />
                  <span>Tümü</span>
                </button>
                <button
                  type="button"
                  data-selected={selectedCategory === 'Favoriler' ? 'true' : 'false'}
                  onClick={() => onSelectCategory('Favoriler')}
                  className={`touch-compact flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-bold transition-colors ${
                    selectedCategory === 'Favoriler'
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                      : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] hover:border-[var(--accent)]'
                  }`}
                >
                  <Heart
                    className={`w-3.5 h-3.5 shrink-0 ${
                      selectedCategory === 'Favoriler'
                        ? 'fill-current'
                        : 'fill-[var(--live)] text-[var(--live)]'
                    }`}
                  />
                  <span>Favoriler ({favoriteIds.size})</span>
                </button>
              </div>

              <div
                ref={drawerCatsRef}
                className="flex items-center gap-1.5 overflow-x-auto touch-scroll-x pb-1"
              >
                {visibleCategories
                  .filter((cat) => cat !== 'Tümü' && cat !== 'Favoriler')
                  .map((cat) => {
                    const selected = cat === selectedCategory;
                    return (
                      <button
                        key={cat}
                        type="button"
                        data-selected={selected ? 'true' : 'false'}
                        onClick={() => onSelectCategory(cat)}
                        className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] transition-colors ${
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
              className="flex-1 min-h-0 overflow-y-auto touch-scroll-y p-2.5 space-y-2"
            >
              {channels.slice(0, drawerLimit).map((ch) => (
                <ChannelRowItem
                  key={ch.id}
                  channel={ch}
                  compact
                  epgNow={lookupEpgForChannel(epgMap, ch.name)?.now?.title ?? null}
                  perfStats={perfMap[getChannelPerfKey(ch)] ?? null}
                  isPlaying={currentChannel?.id === ch.id}
                  isFavorite={favoriteIds.has(ch.name)}
                  onSelect={() => onSelectChannel(ch)}
                  onToggleFavorite={() => onToggleFavorite(ch)}
                />
              ))}
              {channels.length === 0 && (
                <div className="py-10 text-center text-xs text-[var(--muted)] space-y-2">
                  <div>Bu filtrede kanal bulunamadı.</div>
                  <button
                    type="button"
                    onClick={() => {
                      onSearchChange('');
                      onSelectCategory('Tümü');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] font-bold"
                  >
                    Tüm Kanalları Göster
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
