import { Radio } from 'lucide-react';
import type {
  Channel,
  RadioEffectIntensity,
  RadioEffectMode,
} from '../types/channel';

interface RadioVisualizerOverlayProps {
  channel: Channel;
  isPlaying?: boolean;
  effectMode?: RadioEffectMode;
  intensity?: RadioEffectIntensity;
  showLogo?: boolean;
  backgroundImage?: string;
}

const FULL_SPECTRUM_BARS = Array.from({ length: 34 }, (_, idx) => ({
  idx,
  durationMs: 240 + ((idx * 97) % 520),
  heightPct: 36 + ((idx * 37) % 64),
}));

const COSMIC_ORBS = [
  { left: '12%', top: '20%', size: 92, delay: '0s', speed: '6.2s', hue: 'var(--accent)' },
  { left: '78%', top: '18%', size: 110, delay: '1.1s', speed: '7.4s', hue: 'var(--secondary)' },
  { left: '22%', top: '72%', size: 120, delay: '0.6s', speed: '8.1s', hue: 'var(--secondary)' },
  { left: '84%', top: '68%', size: 84, delay: '1.7s', speed: '5.8s', hue: 'var(--accent)' },
  { left: '48%', top: '16%', size: 68, delay: '2.2s', speed: '6.9s', hue: 'var(--live)' },
  { left: '64%', top: '78%', size: 76, delay: '0.3s', speed: '7.1s', hue: 'var(--accent)' },
  { left: '34%', top: '36%', size: 54, delay: '1.5s', speed: '5.4s', hue: 'var(--accent)' },
  { left: '58%', top: '42%', size: 64, delay: '2.7s', speed: '6.4s', hue: 'var(--secondary)' },
];

export function RadioVisualizerOverlay({
  channel,
  isPlaying = true,
  effectMode = 'aurora',
  intensity = 'vivid',
  showLogo = true,
  backgroundImage = '',
}: RadioVisualizerOverlayProps) {
  const speedMultiplier =
    intensity === 'calm' ? 1.45 : intensity === 'medium' ? 1.0 : 0.72;
  const opacityScale =
    intensity === 'calm' ? 0.45 : intensity === 'medium' ? 0.72 : 0.95;

  const trimmedBg = backgroundImage.trim();
  const safeBgSrc = trimmedBg
    ? trimmedBg.startsWith('data:image/')
      ? trimmedBg
      : trimmedBg.startsWith('http://') || trimmedBg.startsWith('https://')
      ? `/api/logo?url=${encodeURIComponent(trimmedBg)}`
      : ''
    : '';

  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-10 select-none overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at center, var(--surface-elevated) 0%, var(--bg) 90%)',
      }}
    >
      {/* Optional User Custom Background Photo */}
      {safeBgSrc && (
        <>
          <img
            src={safeBgSrc}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-45 scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)]/90 via-[var(--bg)]/55 to-[var(--bg)]/80" />
        </>
      )}

      {/* Effect Layer 1: Aurora Dalgaları */}
      {effectMode === 'aurora' && (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ opacity: opacityScale }}
        >
          <div
            className={`absolute -top-1/4 -left-1/4 w-3/4 h-3/4 rounded-full blur-3xl ${
              isPlaying ? 'animate-radio-aurora' : ''
            }`}
            style={{
              background:
                'radial-gradient(circle, var(--accent) 0%, transparent 68%)',
              opacity: 0.42,
              ['--fx-speed' as string]: `${9 * speedMultiplier}s`,
            }}
          />
          <div
            className={`absolute -bottom-1/4 -right-1/4 w-3/4 h-3/4 rounded-full blur-3xl ${
              isPlaying ? 'animate-radio-aurora-rev' : ''
            }`}
            style={{
              background:
                'radial-gradient(circle, var(--secondary) 0%, transparent 68%)',
              opacity: 0.42,
              ['--fx-speed' as string]: `${11 * speedMultiplier}s`,
            }}
          />
          <div
            className={`absolute top-1/4 left-1/3 w-1/2 h-1/2 rounded-full blur-3xl ${
              isPlaying ? 'animate-radio-aurora' : ''
            }`}
            style={{
              background:
                'radial-gradient(circle, var(--live) 0%, transparent 70%)',
              opacity: 0.25,
              ['--fx-speed' as string]: `${13 * speedMultiplier}s`,
            }}
          />
        </div>
      )}

      {/* Effect Layer 2: Nabız Halkaları (Concentric Sonic Pulse Rings) */}
      {(effectMode === 'pulse' || effectMode === 'aurora') && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ opacity: effectMode === 'pulse' ? opacityScale : opacityScale * 0.55 }}
        >
          {[0, 1, 2, 3].map((ringIdx) => (
            <div
              key={ringIdx}
              className={`absolute w-32 h-32 sm:w-44 sm:h-44 rounded-full border-2 ${
                isPlaying ? 'animate-radio-pulse' : ''
              }`}
              style={{
                borderColor: ringIdx % 2 === 0 ? 'var(--accent)' : 'var(--secondary)',
                animationDelay: `${ringIdx * 0.8 * speedMultiplier}s`,
                ['--fx-speed' as string]: `${3.2 * speedMultiplier}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Effect Layer 3: Kozmik Parıltı (Floating Light Orbs) */}
      {effectMode === 'cosmic' && (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ opacity: opacityScale }}
        >
          {COSMIC_ORBS.map((orb, idx) => (
            <div
              key={idx}
              className={`absolute rounded-full blur-xl ${
                isPlaying ? 'animate-radio-orb' : ''
              }`}
              style={{
                left: orb.left,
                top: orb.top,
                width: orb.size,
                height: orb.size,
                backgroundColor: orb.hue,
                opacity: 0.35,
                animationDelay: orb.delay,
                ['--fx-speed' as string]: orb.speed,
              }}
            />
          ))}
        </div>
      )}

      {/* Effect Layer 4: Full-Width Bottom Spectrum Equalizer (for Equalizer, Aurora, Cosmic, Pulse) */}
      {effectMode !== 'off' && (
        <div
          className={`absolute inset-x-0 bottom-0 flex items-end justify-center gap-1 sm:gap-1.5 px-3 pointer-events-none ${
            effectMode === 'equalizer' ? 'h-3/4 pb-12' : 'h-28 sm:h-36 pb-10'
          }`}
          style={{
            opacity:
              effectMode === 'equalizer' ? opacityScale * 0.85 : opacityScale * 0.45,
          }}
        >
          {FULL_SPECTRUM_BARS.map((bar) => (
            <div
              key={bar.idx}
              className={`flex-1 max-w-3 rounded-t-md ${
                isPlaying ? 'animate-eq-bar' : ''
              }`}
              style={{
                height: `${bar.heightPct}%`,
                background:
                  bar.idx % 3 === 0
                    ? 'linear-gradient(to top, var(--accent), var(--secondary))'
                    : 'linear-gradient(to top, var(--accent), rgba(255,255,255,0.75))',
                ['--eq-duration' as string]: `${Math.round(
                  bar.durationMs * speedMultiplier
                )}ms`,
              }}
            />
          ))}
        </div>
      )}

      {/* Centered Station Card */}
      <div className="relative z-10 flex flex-col items-center text-center px-5 pb-12">
        <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-[var(--surface)]/85 backdrop-blur-md border-2 border-[var(--accent)]/80 shadow-2xl flex items-center justify-center overflow-hidden">
          {showLogo && channel.logoUrl ? (
            <img
              src={`/api/logo?url=${encodeURIComponent(channel.logoUrl)}`}
              alt={channel.name}
              className="w-14 h-14 sm:w-16 sm:h-16 object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <Radio className="w-9 h-9 sm:w-11 sm:h-11 text-[var(--accent)]" />
          )}
        </div>

        <div className="mt-3 text-white font-extrabold text-base sm:text-lg tracking-tight drop-shadow-md">
          {channel.name}
        </div>

        <div className="mt-1 flex items-center gap-2 text-xs text-white/80 font-medium">
          <span className="px-2 py-0.5 rounded bg-[var(--accent)] text-[var(--accent-ink)] text-[10px] font-extrabold uppercase tracking-wider">
            CANLI RADYO
          </span>
          {channel.codec && (
            <span className="font-mono-nums text-[11px] text-white/75">
              {channel.codec}
              {channel.bitrate ? ` · ${channel.bitrate} kbps` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
