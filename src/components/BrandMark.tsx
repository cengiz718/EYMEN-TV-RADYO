import { useState } from 'react';
import {
  Baby,
  Compass,
  Film,
  Flame,
  Globe,
  Heart,
  Layers,
  Music,
  Newspaper,
  Radio,
  Sparkles,
  Trophy,
  Tv,
} from 'lucide-react';
import type { CategoryName } from '../types/channel';

export function BrandMark({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M17 7.5L24 14L31 7.5"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="6.5"
        y="14"
        width="35"
        height="24"
        rx="6"
        stroke="currentColor"
        strokeWidth="3.2"
      />
      <path
        d="M20.5 21.2C20.5 20.1 21.7 19.4 22.6 20L30.8 24.8C31.7 25.3 31.7 26.7 30.8 27.2L22.6 32C21.7 32.6 20.5 31.9 20.5 30.8V21.2Z"
        fill="currentColor"
      />
      <rect x="16" y="41" width="16" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function AppLogoBadge({
  className = 'w-9 h-9',
}: {
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);
  if (imgError) {
    return (
      <div
        className={`${className} rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] flex items-center justify-center shadow-sm overflow-hidden`}
      >
        <BrandMark className="w-[62%] h-[62%]" />
      </div>
    );
  }
  return (
    <div
      className={`${className} rounded-xl bg-[#0a0c10] border border-[var(--accent)]/60 flex items-center justify-center shadow-md overflow-hidden`}
    >
      <img
        src="/app-icon.jpg"
        alt="Eymen TV & Radyo"
        onError={() => setImgError(true)}
        className="w-full h-full object-cover"
      />
    </div>
  );
}

export function CategoryIcon({
  category,
  selected = false,
  className = 'w-3.5 h-3.5 shrink-0',
}: {
  category: CategoryName;
  selected?: boolean;
  className?: string;
}) {
  switch (category) {
    case 'Tümü':
      return <Layers className={className} />;
    case 'Favoriler':
      return (
        <Heart
          className={`${className} ${
            selected ? 'fill-[var(--accent-ink)]' : 'text-[var(--live)]'
          }`}
        />
      );
    case 'Haber & Ulusal':
      return <Newspaper className={className} />;
    case 'Spor':
      return <Trophy className={className} />;
    case 'Kürtçe Yayınlar':
      return <Globe className={className} />;
    case 'Radyo & Müzik':
      return <Music className={className} />;
    case 'Sinema & Dizi':
      return <Film className={className} />;
    case 'Belgesel & Doğa':
      return <Compass className={className} />;
    case 'Çocuk & Eğitim':
      return <Baby className={className} />;
    case 'Yerel & Diğer':
      return <Flame className={className} />;
    default:
      return <Tv className={className} />;
  }
}

export { Radio, Sparkles };
