import type { HlsConfig } from 'hls.js';
import type { BufferPreset } from '../types/channel';

export interface HlsProfileInput {
  acceleratedPlaybackMode: boolean;
  bufferPreset: BufferPreset;
  lowRamMode: boolean;
  isMultiScreen?: boolean;
}

export interface HlsProfileSummary {
  maxBufferLength: number;
  maxMaxBufferLength: number;
  maxBufferSizeBytes: number;
  liveSyncDurationCount: number;
  fragLoadingMaxRetry: number;
  abrDefaultKbps: number;
  modeLabel: string;
}

export function getHlsProfileSummary({
  acceleratedPlaybackMode,
  bufferPreset,
  lowRamMode,
  isMultiScreen = false,
}: HlsProfileInput): HlsProfileSummary {
  const baseBuffer =
    bufferPreset === 'ultra'
      ? lowRamMode
        ? 42
        : 60
      : bufferPreset === 'fast'
      ? 14
      : lowRamMode
      ? 24
      : 34;

  const baseMaxBuffer =
    bufferPreset === 'ultra'
      ? lowRamMode
        ? 75
        : 110
      : bufferPreset === 'fast'
      ? 28
      : lowRamMode
      ? 48
      : 68;

  // Multi-screen caps per-tile buffer so 2x/4x simultaneous streams don't exhaust RAM or bandwidth
  if (isMultiScreen) {
    const tileBuffer = acceleratedPlaybackMode
      ? Math.min(28, Math.round(baseBuffer * 0.7))
      : lowRamMode
      ? 12
      : 20;
    const tileMax = acceleratedPlaybackMode
      ? Math.min(54, Math.round(baseMaxBuffer * 0.7))
      : lowRamMode
      ? 24
      : 40;
    return {
      maxBufferLength: tileBuffer,
      maxMaxBufferLength: tileMax,
      maxBufferSizeBytes: lowRamMode ? 14 * 1000 * 1000 : 34 * 1000 * 1000,
      liveSyncDurationCount: acceleratedPlaybackMode ? 3 : 2,
      fragLoadingMaxRetry: acceleratedPlaybackMode ? 7 : 4,
      abrDefaultKbps: acceleratedPlaybackMode ? 220 : 380,
      modeLabel: acceleratedPlaybackMode ? 'Hızlandırılmış Çoklu Tampon' : 'Standart Çoklu Tampon',
    };
  }

  if (acceleratedPlaybackMode) {
    const boostedBuffer =
      bufferPreset === 'ultra'
        ? lowRamMode
          ? 52
          : 75
        : bufferPreset === 'fast'
        ? lowRamMode
          ? 20
          : 26
        : lowRamMode
        ? 34
        : 48;

    const boostedMaxBuffer =
      bufferPreset === 'ultra'
        ? lowRamMode
          ? 96
          : 150
        : bufferPreset === 'fast'
        ? lowRamMode
          ? 40
          : 52
        : lowRamMode
        ? 68
        : 96;

    return {
      maxBufferLength: boostedBuffer,
      maxMaxBufferLength: boostedMaxBuffer,
      maxBufferSizeBytes: lowRamMode ? 36 * 1000 * 1000 : 95 * 1000 * 1000,
      liveSyncDurationCount: bufferPreset === 'fast' ? 2 : 3,
      fragLoadingMaxRetry: 8,
      abrDefaultKbps: bufferPreset === 'fast' ? 260 : 200,
      modeLabel: 'Hızlandırılmış Anti-Donma Modu',
    };
  }

  return {
    maxBufferLength: baseBuffer,
    maxMaxBufferLength: baseMaxBuffer,
    maxBufferSizeBytes: lowRamMode ? 22 * 1000 * 1000 : 60 * 1000 * 1000,
    liveSyncDurationCount: 2,
    fragLoadingMaxRetry: 4,
    abrDefaultKbps: 450,
    modeLabel: 'Standart Oynatma Modu',
  };
}

export function buildHlsConfig(input: HlsProfileInput): Partial<HlsConfig> {
  const summary = getHlsProfileSummary(input);
  const { acceleratedPlaybackMode, lowRamMode, isMultiScreen = false } = input;

  return {
    enableWorker: true,
    lowLatencyMode: false,
    startFragPrefetch: true,
    progressive: true,
    maxBufferLength: summary.maxBufferLength,
    maxMaxBufferLength: summary.maxMaxBufferLength,
    backBufferLength: isMultiScreen ? (lowRamMode ? 2 : 8) : lowRamMode ? 6 : 18,
    maxBufferSize: summary.maxBufferSizeBytes,
    maxBufferHole: acceleratedPlaybackMode ? 1.2 : 0.6,
    highBufferWatchdogPeriod: acceleratedPlaybackMode ? 1.5 : 2,
    nudgeOffset: acceleratedPlaybackMode ? 0.3 : 0.15,
    nudgeMaxRetry: acceleratedPlaybackMode ? 15 : 8,
    liveSyncDurationCount: summary.liveSyncDurationCount,
    liveMaxLatencyDurationCount: acceleratedPlaybackMode ? 10 : 6,
    abrEwmaDefaultEstimate: summary.abrDefaultKbps * 1000,
    abrEwmaFastLive: acceleratedPlaybackMode ? 2.0 : 3.0,
    abrEwmaSlowLive: acceleratedPlaybackMode ? 6.0 : 9.0,
    abrBandWidthFactor: acceleratedPlaybackMode ? 0.65 : 0.85,
    abrBandWidthUpFactor: acceleratedPlaybackMode ? 0.45 : 0.65,
    capLevelToPlayerSize: isMultiScreen || lowRamMode,
    startLevel: acceleratedPlaybackMode ? 0 : -1,
    manifestLoadingMaxRetry: acceleratedPlaybackMode ? 6 : 4,
    manifestLoadingRetryDelay: acceleratedPlaybackMode ? 400 : 800,
    levelLoadingMaxRetry: acceleratedPlaybackMode ? 6 : 4,
    levelLoadingRetryDelay: acceleratedPlaybackMode ? 400 : 800,
    fragLoadingMaxRetry: summary.fragLoadingMaxRetry,
    fragLoadingRetryDelay: acceleratedPlaybackMode ? 350 : 700,
    fragLoadingMaxRetryTimeout: 12000,
    manifestLoadingTimeOut: 20000,
    levelLoadingTimeOut: 20000,
    fragLoadingTimeOut: 26000,
  };
}
