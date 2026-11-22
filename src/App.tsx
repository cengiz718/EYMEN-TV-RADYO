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
      title: "Örnek TV 1",
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
  ],
  radio: [
    {
      id: "rad-1",
      title: "Türkü & Özgün Radyo",
      category: "radio",
      group: "Müzik",
      sources: [
        {
          id: "rad-1-s1",
          label: "Ana Radyo",
          url: "https://stream.example.com/turku-ana.mp3",
          priority: 1,
        },
        {
          id: "rad-1-s2",
          label: "Yedek Radyo",
          url: "https://stream.example.com/turku-yedek.mp3",
          priority: 2,
        },
      ],
    },
  ],
  movie: [
    {
      id: "mov-1",
      title: "Örnek Film",
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
      title: "Örnek Dizi - S01E01",
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
        {
          id: "ser-1-s2",
          label: "Yedek Bölüm",
          url: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
          priority: 2,
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

export function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<EymenStreamController | null>(null);

  const [activeCategory, setActiveCategory] = useState<MediaCategory>("tv");
  const [catalogs, setCatalogs] =
    useState<Record<MediaCategory, MediaItem[]>>(FALLBACK_CATALOG);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    "Yayın seçmek için bir kart seçin"
  );
  const [isPlayerOpen, setIsPlayerOpen] = useState<boolean>(false);

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

  const handleSelectItem = (item: MediaItem) => {
    setSelectedItem(item);
    setIsPlayerOpen(true);
    setStatusMessage(`${item.title} hazırlanıyor...`);

    // DOM görünürlüğü güncellendikten hemen sonra oynatmayı başlat
    requestAnimationFrame(() => {
      controllerRef.current?.playItem(item, 0);
    });
  };

  const handleSwitchBackup = () => {
    controllerRef.current?.cycleSourceManual();
  };

  const handleClosePlayer = () => {
    controllerRef.current?.stop();
    setIsPlayerOpen(false);
    setStatusMessage("Oynatıcı kapatıldı");
  };

  const currentItems = catalogs[activeCategory] || [];

  return (
    <div style={{ minHeight: "100vh", background: "#0c0f16", color: "#f3f6fc" }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          padding: "14px 18px",
          background: "#151a26",
          borderBottom: "1px solid #263046",
        }}
      >
        {(Object.keys(CATEGORY_LABELS) as MediaCategory[]).map((cat) => {
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: "10px 18px",
                borderRadius: "8px",
                border: "1px solid #33415f",
                background: isActive ? "#38bdf8" : "#1d2434",
                color: isActive ? "#07111a" : "#f3f6fc",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          );
        })}
      </header>

      <main
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "14px",
          padding: "18px",
        }}
      >
        {currentItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleSelectItem(item)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: "6px",
              padding: "16px",
              borderRadius: "12px",
              border: "1px solid #283248",
              background: "#1d2434",
              color: "#f3f6fc",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <strong>{item.title}</strong>
            <span style={{ fontSize: "13px", color: "#9aa5bd" }}>
              {item.group || CATEGORY_LABELS[item.category]} •{" "}
              {item.sources.length} kaynak
            </span>
          </button>
        ))}
      </main>

      <section
        aria-label="Medya Oynatıcı"
        style={{
          display: isPlayerOpen ? "flex" : "none",
          position: "fixed",
          inset: 0,
          background: "#000",
          flexDirection: "column",
          justifyContent: "space-between",
          zIndex: 50,
        }}
      >
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          style={{ width: "100%", height: "100%", maxHeight: "78vh" }}
        />

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "12px 18px",
            background: "#141923",
          }}
        >
          <div>
            <div style={{ fontWeight: 700 }}>
              {selectedItem?.title || "Yayın"}
            </div>
            <div style={{ fontSize: "13px", color: "#facc15" }}>
              {statusMessage}
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={handleSwitchBackup}
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid #3c4b69",
                background: "#1f293d",
                color: "#f3f6fc",
                cursor: "pointer",
              }}
            >
              Yedek Kaynak Değiştir
            </button>
            <button
              type="button"
              onClick={handleClosePlayer}
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid #7f1d1d",
                background: "#450a0a",
                color: "#fecaca",
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
