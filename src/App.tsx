import React, { useEffect, useRef, useState } from "react";
import {
  EymenStreamController,
  loadAllCatalogs,
  MediaCategory,
  MediaItem,
} from "./streamManager";

const FALLBACK_CATALOG: Record<MediaCategory, MediaItem[]> = {
  tv: [
    {
      id: "tv-1",
      title: "Ulusal Kanal 1",
      category: "tv",
      group: "Ulusal",
      sources: [
        {
          id: "tv-1-s1",
          label: "Ana Yayın",
          url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
          priority: 1,
        },
        {
          id: "tv-1-s2",
          label: "Yedek Yayın 1",
          url: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
          priority: 2,
        },
      ],
    },
    {
      id: "tv-2",
      title: "Haber TV HD",
      category: "tv",
      group: "Haber",
      sources: [
        {
          id: "tv-2-s1",
          label: "Ana Yayın",
          url: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
          priority: 1,
        },
      ],
    },
    {
      id: "tv-3",
      title: "Spor Ekranı",
      category: "tv",
      group: "Spor",
      sources: [
        {
          id: "tv-3-s1",
          label: "Ana Yayın",
          url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
          priority: 1,
        },
      ],
    },
    {
      id: "tv-4",
      title: "Belgesel Kuşağı",
      category: "tv",
      group: "Belgesel",
      sources: [
        {
          id: "tv-4-s1",
          label: "Ana Yayın",
          url: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
          priority: 1,
        },
      ],
    },
  ],
  radio: [
    {
      id: "rad-1",
      title: "Türkü & Özgün FM",
      category: "radio",
      group: "Müzik",
      sources: [
        {
          id: "rad-1-s1",
          label: "Ana Radyo",
          url: "https://stream.example.com/turku.mp3",
          priority: 1,
        },
        {
          id: "rad-1-s2",
          label: "Yedek Radyo",
          url: "https://backup.example.com/turku.mp3",
          priority: 2,
        },
      ],
    },
    {
      id: "rad-2",
      title: "Arabesk & Damar",
      category: "radio",
      group: "Müzik",
      sources: [
        {
          id: "rad-2-s1",
          label: "Ana Radyo",
          url: "https://stream.example.com/arabesk.mp3",
          priority: 1,
        },
      ],
    },
    {
      id: "rad-3",
      title: "Haber Radyo",
      category: "radio",
      group: "Haber",
      sources: [
        {
          id: "rad-3-s1",
          label: "Ana Radyo",
          url: "https://stream.example.com/haber.mp3",
          priority: 1,
        },
      ],
    },
  ],
  movie: [
    {
      id: "mov-1",
      title: "Örnek Film 1",
      category: "movie",
      group: "Sinema",
      sources: [
        {
          id: "mov-1-s1",
          label: "Ana Sunucu",
          url: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
          priority: 1,
        },
      ],
    },
  ],
  series: [
    {
      id: "ser-1",
      title: "Örnek Dizi • S01E01",
      category: "series",
      group: "1. Sezon",
      season: 1,
      episode: 1,
      sources: [
        {
          id: "ser-1-s1",
          label: "Ana Bölüm",
          url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
          priority: 1,
        },
      ],
    },
  ],
};

const CATEGORY_LABELS: Record<MediaCategory, string> = {
  tv: "TV",
  radio: "Radyo",
  movie: "Film",
  series: "Dizi",
};

const THEME = {
  night: {
    bg: "#090d16",
    surface: "rgba(18, 25, 40, 0.92)",
    card: "rgba(26, 36, 56, 0.88)",
    cardFocus: "rgba(42, 58, 90, 0.98)",
    text: "#f8fafc",
    muted: "#cbd5e1",
    accent: "#38bdf8",
    focus: "#facc15",
    border: "rgba(148, 163, 184, 0.3)",
  },
  day: {
    bg: "#e2e8f0",
    surface: "rgba(255, 255, 255, 0.94)",
    card: "rgba(255, 255, 255, 0.9)",
    cardFocus: "rgba(224, 242, 254, 0.98)",
    text: "#0f172a",
    muted: "#334155",
    accent: "#0284c7",
    focus: "#d97706",
    border: "rgba(15, 23, 42, 0.2)",
  },
};

function BrandLogo({ accent }: { accent: string }) {
  return (
    <svg width="42" height="42" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill={accent} fillOpacity="0.18" />
      <rect
        x="11"
        y="16"
        width="42"
        height="28"
        rx="7"
        stroke={accent}
        strokeWidth="3.5"
      />
      <polygon points="28,24 39,30 28,36" fill={accent} />
      <line
        x1="22"
        y1="50"
        x2="42"
        y2="50"
        stroke={accent}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

type FocusColumn = "tv" | "radio" | "extra";

type FocusTarget = {
  column: FocusColumn;
  index: number;
};

export function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<EymenStreamController | null>(null);
  const tvCardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const radioCardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const extraCardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const backupBtnRef = useRef<HTMLButtonElement | null>(null);

  const [activeCategory, setActiveCategory] = useState<MediaCategory>("tv");
  const [catalogs, setCatalogs] =
    useState<Record<MediaCategory, MediaItem[]>>(FALLBACK_CATALOG);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>({
    column: "tv",
    index: 0,
  });
  const [lastPlayedTarget, setLastPlayedTarget] = useState<FocusTarget>({
    column: "tv",
    index: 0,
  });
  const [statusMessage, setStatusMessage] = useState<string>(
    "Yayın seçmek için bir kart seçin"
  );
  const [isPlayerOpen, setIsPlayerOpen] = useState<boolean>(false);
  const [themeMode, setThemeMode] = useState<"night" | "day">("night");

  const theme = THEME[themeMode];
  const isNight = themeMode === "night";

  const tvItems = catalogs.tv || [];
  const radioItems = catalogs.radio || [];
  const extraItems =
    activeCategory === "movie" || activeCategory === "series"
      ? catalogs[activeCategory] || []
      : [];

  const getPoolForColumn = (column: FocusColumn): Array<HTMLButtonElement | null> => {
    if (column === "tv") return tvCardRefs.current;
    if (column === "radio") return radioCardRefs.current;
    return extraCardRefs.current;
  };

  const focusElement = (target: FocusTarget) => {
    const pool = getPoolForColumn(target.column);
    const clampedIdx = Math.max(0, Math.min(target.index, pool.length - 1));
    const el = pool[clampedIdx];
    if (el) {
      el.focus({ preventScroll: false });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  useEffect(() => {
    const mediaEl = videoRef.current;
    if (!mediaEl) return;

    const controller = new EymenStreamController(mediaEl, {
      failoverTimeoutMs: 5000,
      onStatus: ({ message }) => {
        setStatusMessage(message);
      },
    });
    controllerRef.current = controller;

    loadAllCatalogs({}, FALLBACK_CATALOG)
      .then((loaded) => {
        setCatalogs(loaded);
      })
      .catch(() => {
        setCatalogs(FALLBACK_CATALOG);
      });

    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isPlayerOpen) return;
    const initial: FocusTarget =
      activeCategory === "radio"
        ? { column: "radio", index: 0 }
        : activeCategory === "movie" || activeCategory === "series"
          ? { column: "extra", index: 0 }
          : { column: "tv", index: 0 };
    setFocusTarget(initial);
    const timer = window.setTimeout(() => {
      focusElement(initial);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [activeCategory, catalogs, isPlayerOpen]);

  const handleClosePlayer = () => {
    controllerRef.current?.stop();
    setIsPlayerOpen(false);
    setStatusMessage("Oynatıcı kapatıldı");

    window.setTimeout(() => {
      setFocusTarget(lastPlayedTarget);
      focusElement(lastPlayedTarget);
    }, 50);
  };

  useEffect(() => {
    if (!isPlayerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClosePlayer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleSelectItem = (
    item: MediaItem,
    column: FocusColumn,
    index: number
  ) => {
    const currentTarget = { column, index };
    setSelectedItem(item);
    setFocusTarget(currentTarget);
    setLastPlayedTarget(currentTarget);
    setIsPlayerOpen(true);
    setStatusMessage(`${item.title} hazırlanıyor...`);

    requestAnimationFrame(() => {
      controllerRef.current?.playItem(item, 0);
      backupBtnRef.current?.focus();
    });
  };

  const handleSwitchBackup = () => {
    controllerRef.current?.cycleSourceManual();
    backupBtnRef.current?.focus();
  };

  const handleColumnKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    column: FocusColumn,
    index: number
  ) => {
    const tvLen = tvItems.length;
    const radioLen = radioItems.length;
    const extraLen = extraItems.length;

    let next: FocusTarget | null = null;

    if (e.key === "ArrowDown") {
      if (column === "tv" && index + 1 < tvLen) {
        next = { column: "tv", index: index + 1 };
      } else if (column === "radio" && index + 1 < radioLen) {
        next = { column: "radio", index: index + 1 };
      } else if (column === "extra" && index + 1 < extraLen) {
        next = { column: "extra", index: index + 1 };
      }
    } else if (e.key === "ArrowUp") {
      if (index - 1 >= 0) {
        next = { column, index: index - 1 };
      }
    } else if (e.key === "ArrowRight") {
      if (column === "tv" && radioLen > 0) {
        next = { column: "radio", index: Math.min(index, radioLen - 1) };
      } else if (column === "extra" && index + 1 < extraLen) {
        next = { column: "extra", index: index + 1 };
      }
    } else if (e.key === "ArrowLeft") {
      if (column === "radio" && tvLen > 0) {
        next = { column: "tv", index: Math.min(index, tvLen - 1) };
      } else if (column === "extra" && index - 1 >= 0) {
        next = { column: "extra", index: index - 1 };
      }
    }

    if (next) {
      e.preventDefault();
      e.stopPropagation();
      setFocusTarget(next);
      focusElement(next);
    }
  };

  const cardTextStyle: React.CSSProperties = {
    fontSize: "16px",
    fontWeight: 800,
    lineHeight: 1.35,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const metaTextStyle: React.CSSProperties = {
    fontSize: "13px",
    color: theme.muted,
    fontWeight: 600,
    lineHeight: 1.3,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        maxWidth: "100vw",
        overflowX: "hidden",
        backgroundColor: theme.bg,
        color: theme.text,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        *, *::before, *::after {
          box-sizing: border-box;
        }
        button:focus,
        button:focus-visible {
          outline: 4px solid ${theme.focus} !important;
          outline-offset: 2px !important;
        }
        @media (max-width: 640px) {
          .eymen-columns-grid {
            grid-template-columns: 1fr !important;
            padding: 12px !important;
            gap: 14px !important;
          }
        }
      `}</style>

      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "14px 18px",
          backgroundColor: theme.surface,
          borderBottom: `1px solid ${theme.border}`,
          position: "sticky",
          top: 0,
          zIndex: 30,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
          <BrandLogo accent={theme.accent} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "20px", fontWeight: 900, letterSpacing: "0.5px", overflowWrap: "anywhere" }}>
              EYMEN TV RADYO PRO
            </div>
            <div style={{ fontSize: "12px", color: theme.muted, fontWeight: 600 }}>
              TV • Radyo • Film • Dizi
            </div>
          </div>
        </div>

        <nav style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {(Object.keys(CATEGORY_LABELS) as MediaCategory[]).map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                style={{
                  padding: "10px 16px",
                  borderRadius: "10px",
                  border: `1px solid ${isActive ? theme.accent : theme.border}`,
                  backgroundColor: isActive ? theme.accent : theme.card,
                  color: isActive ? "#061018" : theme.text,
                  fontWeight: 800,
                  fontSize: "15px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setThemeMode(isNight ? "day" : "night")}
          style={{
            padding: "10px 16px",
            borderRadius: "10px",
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.card,
            color: theme.text,
            fontWeight: 700,
            fontSize: "14px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {isNight ? "☀️ Gündüz Modu" : "🌙 Gece Modu"}
        </button>
      </header>

      <main
        className="eymen-columns-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "20px",
          padding: "20px",
          flex: 1,
          minWidth: 0,
        }}
      >
        {/* Sol Taraf: TV Listesi */}
        <section
          style={{
            backgroundColor: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: "16px",
            padding: "16px",
            minWidth: 0,
          }}
        >
          <h2
            style={{
              margin: "0 0 14px",
              fontSize: "18px",
              fontWeight: 900,
              color: theme.accent,
              overflowWrap: "anywhere",
            }}
          >
            📺 TV Kanalları (Sol)
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              maxHeight: "65vh",
              overflowY: "auto",
              padding: "4px",
            }}
          >
            {tvItems.map((item, idx) => {
              const isFocused =
                focusTarget.column === "tv" && focusTarget.index === idx;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    tvCardRefs.current[idx] = el;
                  }}
                  type="button"
                  onFocus={() => setFocusTarget({ column: "tv", index: idx })}
                  onKeyDown={(e) => handleColumnKeyDown(e, "tv", idx)}
                  onClick={() => handleSelectItem(item, "tv", idx)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "4px",
                    padding: "14px 16px",
                    borderRadius: "12px",
                    border: isFocused
                      ? `2px solid ${theme.focus}`
                      : `1px solid ${theme.border}`,
                    backgroundColor: isFocused ? theme.cardFocus : theme.card,
                    color: theme.text,
                    textAlign: "left",
                    cursor: "pointer",
                    width: "100%",
                    minWidth: 0,
                  }}
                >
                  <strong style={cardTextStyle}>{item.title}</strong>
                  <span style={metaTextStyle}>
                    {item.group || "TV"} • {item.sources.length} kaynak
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Sağ Taraf: Radyo Listesi */}
        <section
          style={{
            backgroundColor: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: "16px",
            padding: "16px",
            minWidth: 0,
          }}
        >
          <h2
            style={{
              margin: "0 0 14px",
              fontSize: "18px",
              fontWeight: 900,
              color: theme.accent,
              overflowWrap: "anywhere",
            }}
          >
            📻 Radyo İstasyonları (Sağ)
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              maxHeight: "65vh",
              overflowY: "auto",
              padding: "4px",
            }}
          >
            {radioItems.map((item, idx) => {
              const isFocused =
                focusTarget.column === "radio" && focusTarget.index === idx;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    radioCardRefs.current[idx] = el;
                  }}
                  type="button"
                  onFocus={() => setFocusTarget({ column: "radio", index: idx })}
                  onKeyDown={(e) => handleColumnKeyDown(e, "radio", idx)}
                  onClick={() => handleSelectItem(item, "radio", idx)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "4px",
                    padding: "14px 16px",
                    borderRadius: "12px",
                    border: isFocused
                      ? `2px solid ${theme.focus}`
                      : `1px solid ${theme.border}`,
                    backgroundColor: isFocused ? theme.cardFocus : theme.card,
                    color: theme.text,
                    textAlign: "left",
                    cursor: "pointer",
                    width: "100%",
                    minWidth: 0,
                  }}
                >
                  <strong style={cardTextStyle}>{item.title}</strong>
                  <span style={metaTextStyle}>
                    {item.group || "Radyo"} • {item.sources.length} kaynak
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </main>

      {extraItems.length > 0 && (
        <section
          style={{
            margin: "0 20px 20px",
            backgroundColor: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: "16px",
            padding: "16px",
            minWidth: 0,
          }}
        >
          <h2
            style={{
              margin: "0 0 14px",
              fontSize: "18px",
              fontWeight: 900,
              color: theme.accent,
            }}
          >
            {activeCategory === "movie" ? "🎬 Filmler" : "🎞️ Diziler"}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: "12px",
            }}
          >
            {extraItems.map((item, idx) => {
              const isFocused =
                focusTarget.column === "extra" && focusTarget.index === idx;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    extraCardRefs.current[idx] = el;
                  }}
                  type="button"
                  onFocus={() => setFocusTarget({ column: "extra", index: idx })}
                  onKeyDown={(e) => handleColumnKeyDown(e, "extra", idx)}
                  onClick={() => handleSelectItem(item, "extra", idx)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "6px",
                    padding: "14px",
                    borderRadius: "12px",
                    border: isFocused
                      ? `2px solid ${theme.focus}`
                      : `1px solid ${theme.border}`,
                    backgroundColor
