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
    surface: "rgba(18, 25, 40, 0.78)",
    card: "rgba(26, 36, 56, 0.72)",
    cardHover: "rgba(38, 52, 80, 0.92)",
    text: "#f8fafc",
    muted: "#cbd5e1",
    accent: "#38bdf8",
    focus: "#facc15",
    border: "rgba(148, 163, 184, 0.28)",
  },
  day: {
    bg: "#e2e8f0",
    surface: "rgba(255, 255, 255, 0.82)",
    card: "rgba(255, 255, 255, 0.76)",
    cardHover: "rgba(241, 245, 249, 0.96)",
    text: "#0f172a",
    muted: "#334155",
    accent: "#0284c7",
    focus: "#d97706",
    border: "rgba(15, 23, 42, 0.18)",
  },
};

function BrandLogo({ accent }: { accent: string }) {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
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

export function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<EymenStreamController | null>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const backupBtnRef = useRef<HTMLButtonElement | null>(null);

  const [activeCategory, setActiveCategory] = useState<MediaCategory>("tv");
  const [catalogs, setCatalogs] =
    useState<Record<MediaCategory, MediaItem[]>>(FALLBACK_CATALOG);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [lastPlayedIndex, setLastPlayedIndex] = useState<number>(0);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>(
    "Yayın seçmek için bir kart seçin"
  );
  const [isPlayerOpen, setIsPlayerOpen] = useState<boolean>(false);
  const [themeMode, setThemeMode] = useState<"night" | "day">("night");

  const theme = THEME[themeMode];
  const isNight = themeMode === "night";

  const focusCardAt = (idx: number) => {
    const target = cardRefs.current[idx];
    if (target) {
      target.focus();
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
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

    loadAllCatalogs({}, FALLBACK_CATALOG).then((loaded) => {
      setCatalogs(loaded);
    });

    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isPlayerOpen) return;
    setFocusedIndex(0);
    const timer = window.setTimeout(() => {
      focusCardAt(0);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [activeCategory, catalogs, isPlayerOpen]);

  const handleSelectItem = (item: MediaItem, idx: number) => {
    setSelectedItem(item);
    setLastPlayedIndex(idx);
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

  const handleClosePlayer = () => {
    controllerRef.current?.stop();
    setIsPlayerOpen(false);
    setStatusMessage("Oynatıcı kapatıldı");

    window.setTimeout(() => {
      setFocusedIndex(lastPlayedIndex);
      focusCardAt(lastPlayedIndex);
    }, 60);
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = catalogs[activeCategory] || [];
    if (!items.length) return;

    const cols = Math.max(
      1,
      Math.floor((e.currentTarget.clientWidth || 800) / 240)
    );
    let nextIdx = focusedIndex;

    if (e.key === "ArrowRight") nextIdx = Math.min(items.length - 1, focusedIndex + 1);
    else if (e.key === "ArrowLeft") nextIdx = Math.max(0, focusedIndex - 1);
    else if (e.key === "ArrowDown") nextIdx = Math.min(items.length - 1, focusedIndex + cols);
    else if (e.key === "ArrowUp") nextIdx = Math.max(0, focusedIndex - cols);
    else return;

    e.preventDefault();
    setFocusedIndex(nextIdx);
    focusCardAt(nextIdx);
  };

  const tvItems = catalogs.tv || [];
  const radioItems = catalogs.radio || [];
  const extraItems =
    activeCategory === "movie" || activeCategory === "series"
      ? catalogs[activeCategory] || []
      : [];

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: theme.bg,
        color: theme.text,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        button:focus,
        button:focus-visible {
          outline: 3px solid ${theme.focus} !important;
          outline-offset: 2px !important;
          transform: scale(1.02);
        }
      `}</style>

      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "14px 20px",
          backgroundColor: theme.surface,
          backdropFilter: "blur(12px)",
          borderBottom: `1px solid ${theme.border}`,
          position: "sticky",
          top: 0,
          zIndex: 30,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <BrandLogo accent={theme.accent} />
          <div>
            <div style={{ fontSize: "20px", fontWeight: 900, letterSpacing: "0.5px" }}>
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
                  padding: "10px 18px",
                  borderRadius: "10px",
                  border: `1px solid ${isActive ? theme.accent : theme.border}`,
                  backgroundColor: isActive ? theme.accent : theme.card,
                  color: isActive ? "#061018" : theme.text,
                  fontWeight: 800,
                  fontSize: "15px",
                  cursor: "pointer",
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
          }}
        >
          {isNight ? "☀️ Gündüz Modu" : "🌙 Gece Modu"}
        </button>
      </header>

      <main
        role="region"
        aria-label="Yayın Listeleri"
        onKeyDown={handleGridKeyDown}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "20px",
          padding: "20px",
          flex: 1,
        }}
      >
        {/* Sol Taraf: TV Listesi */}
        <section
          style={{
            backgroundColor: theme.surface,
            backdropFilter: "blur(10px)",
            border: `1px solid ${theme.border}`,
            borderRadius: "16px",
            padding: "16px",
          }}
        >
          <h2 style={{ margin: "0 0 14px", fontSize: "18px", fontWeight: 900, color: theme.accent }}>
            📺 TV Kanalları (Sol)
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: "12px",
              maxHeight: "65vh",
              overflowY: "auto",
              padding: "4px",
            }}
          >
            {tvItems.map((item, idx) => (
              <button
                key={item.id}
                ref={(el) => {
                  cardRefs.current[idx] = el;
                }}
                type="button"
                onFocus={() => setFocusedIndex(idx)}
                onClick={() => handleSelectItem(item, idx)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "6px",
                  padding: "14px",
                  borderRadius: "12px",
                  border: `1px solid ${theme.border}`,
                  backgroundColor:
                    focusedIndex === idx ? theme.cardHover : theme.card,
                  color: theme.text,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <strong style={{ fontSize: "15px", fontWeight: 800 }}>
                  {item.title}
                </strong>
                <span style={{ fontSize: "13px", color: theme.muted, fontWeight: 600 }}>
                  {item.group || "TV"} • {item.sources.length} kaynak
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Sağ Taraf: Radyo Listesi */}
        <section
          style={{
            backgroundColor: theme.surface,
            backdropFilter: "blur(10px)",
            border: `1px solid ${theme.border}`,
            borderRadius: "16px",
            padding: "16px",
          }}
        >
          <h2 style={{ margin: "0 0 14px", fontSize: "18px", fontWeight: 900, color: theme.accent }}>
            📻 Radyo İstasyonları (Sağ)
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: "12px",
              maxHeight: "65vh",
              overflowY: "auto",
              padding: "4px",
            }}
          >
            {radioItems.map((item, idx) => {
              const globalIdx = tvItems.length + idx;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    cardRefs.current[globalIdx] = el;
                  }}
                  type="button"
                  onFocus={() => setFocusedIndex(globalIdx)}
                  onClick={() => handleSelectItem(item, globalIdx)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "6px",
                    padding: "14px",
                    borderRadius: "12px",
                    border: `1px solid ${theme.border}`,
                    backgroundColor:
                      focusedIndex === globalIdx ? theme.cardHover : theme.card,
                    color: theme.text,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <strong style={{ fontSize: "15px", fontWeight: 800 }}>
                    {item.title}
                  </strong>
                  <span style={{ fontSize: "13px", color: theme.muted, fontWeight: 600 }}>
                    {item.group || "Radyo"} • {item.sources.length} kaynak
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </main>

      {/* Film veya Dizi Sekmesi Seçildiğinde Alt/Ek Bölüm */}
      {extraItems.length > 0 && (
        <section
          style={{
            margin: "0 20px 20px",
            backgroundColor: theme.surface,
            backdropFilter: "blur(10px)",
            border: `1px solid ${theme.border}`,
            borderRadius: "16px",
            padding: "16px",
          }}
        >
          <h2 style={{ margin: "0 0 14px", fontSize: "18px", fontWeight: 900, color: theme.accent }}>
            {activeCategory === "movie" ? "🎬 Filmler" : "🎞️ Diziler"}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: "12px",
            }}
          >
            {extraItems.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectItem(item, idx)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "6px",
                  padding: "14px",
                  borderRadius: "12px",
                  border: `1px solid ${theme.border}`,
                  backgroundColor: theme.card,
                  color: theme.text,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <strong style={{ fontSize: "15px", fontWeight: 800 }}>{item.title}</strong>
                <span style={{ fontSize: "13px", color: theme.muted, fontWeight: 600 }}>
                  {item.group || CATEGORY_LABELS[item.category]}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Oynatıcı Katmanı (video etiketi her zaman DOM'da hazır) */}
      <section
        aria-label="Medya Oynatıcı"
        style={{
          display: isPlayerOpen ? "flex" : "none",
          position: "fixed",
          inset: 0,
          backgroundColor: "#000",
          flexDirection: "column",
          justifyContent: "space-between",
          zIndex: 60,
        }}
      >
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          style={{ width: "100%", height: "100%", maxHeight: "80vh" }}
        />
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "14px 20px",
            backgroundColor: theme.surface,
            backdropFilter: "blur(12px)",
          }}
        >
          <div>
            <div style={{ fontWeight: 900, fontSize: "17px" }}>
              {selectedItem?.title || "Yayın"}
            </div>
            <div style={{ fontSize: "14px", color: theme.focus, fontWeight: 700 }}>
              {statusMessage}
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              ref={backupBtnRef}
              type="button"
              onClick={handleSwitchBackup}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                border: `1px solid ${theme.border}`,
                backgroundColor: theme.card,
                color: theme.text,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Yedek Kaynak Değiştir
            </button>
            <button
              type="button"
              onClick={handleClosePlayer}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                border: "1px solid #ef4444",
                backgroundColor: "#7f1d1d",
                color: "#fef2f2",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Kapat
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;
