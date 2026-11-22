import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  EymenStreamController,
  loadAllCatalogs,
  MediaCategory,
  MediaItem,
  StreamStatusEvent,
} from "./streamManager";

const CATALOG_URLS = {
  tv: [
    // M3U veya JSON liste URL'lerinizi buraya ekleyebilirsiniz
  ],
  radio: [
    // Radyo M3U veya JSON liste URL'lerinizi buraya ekleyebilirsiniz
  ],
};

const FALLBACK_CATALOG: Record<MediaCategory, MediaItem[]> = {
  tv: [
    {
      id: "tv-1",
      title: "TRT 1",
      category: "tv",
      group: "Ulusal",
      sources: [
        {
          id: "tv-1-s1",
          label: "Ana Yayın",
          url: "https://tv-trt1.medya.trt.com.tr/master.m3u8",
          priority: 1,
        },
      ],
    },
    {
      id: "tv-2",
      title: "TRT Haber",
      category: "tv",
      group: "Haber",
      sources: [
        {
          id: "tv-2-s1",
          label: "Ana Yayın",
          url: "https://tv-trthaber.medya.trt.com.tr/master.m3u8",
          priority: 1,
        },
      ],
    },
    {
      id: "tv-3",
      title: "TRT Spor",
      category: "tv",
      group: "Spor",
      sources: [
        {
          id: "tv-3-s1",
          label: "Ana Yayın",
          url: "https://tv-trtspor.medya.trt.com.tr/master.m3u8",
          priority: 1,
        },
      ],
    },
  ],
  radio: [
    {
      id: "radio-1",
      title: "TRT Radyo 1",
      category: "radio",
      group: "Haber & Spor Radyo",
      sources: [
        {
          id: "radio-1-s1",
          label: "Ana Yayın",
          url: "https://radio-trtradyo1.medya.trt.com.tr/master.m3u8",
          priority: 1,
        },
      ],
    },
    {
      id: "radio-2",
      title: "TRT Türkü",
      category: "radio",
      group: "Türkü & Halk Müziği",
      sources: [
        {
          id: "radio-2-s1",
          label: "Ana Yayın",
          url: "https://radio-trtturku.medya.trt.com.tr/master.m3u8",
          priority: 1,
        },
      ],
    },
  ],
  movie: [],
  series: [],
};

function groupItemsByCategory(items: MediaItem[]): Array<[string, MediaItem[]]> {
  const map = new Map<string, MediaItem[]>();
  for (const item of items) {
    const grp = item.group?.trim() || "Genel";
    if (!map.has(grp)) {
      map.set(grp, []);
    }
    map.get(grp)!.push(item);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "tr"));
}

export default function App() {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<EymenStreamController | null>(null);

  const [tvList, setTvList] = useState<MediaItem[]>(FALLBACK_CATALOG.tv);
  const [radioList, setRadioList] = useState<MediaItem[]>(FALLBACK_CATALOG.radio);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [status, setStatus] = useState<StreamStatusEvent>({
    state: "idle",
    message: "Aşağıdaki menüden bir TV kanalı veya Radyo seçin",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [darkTheme, setDarkTheme] = useState(true);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;

    const controller = new EymenStreamController(el, {
      failoverTimeoutMs: 5000,
      onStatus: (ev) => setStatus(ev),
    });
    controllerRef.current = controller;

    void loadAllCatalogs(CATALOG_URLS, FALLBACK_CATALOG).then((catalog) => {
      if (catalog.tv.length > 0) setTvList(catalog.tv);
      if (catalog.radio.length > 0) setRadioList(catalog.radio);
    });

    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  const handleSelectItem = (item: MediaItem) => {
    setSelectedItem(item);
    controllerRef.current?.playItem(item, 0);
  };

  const handleManualFailover = () => {
    controllerRef.current?.cycleSourceManual();
  };

  const handleStop = () => {
    controllerRef.current?.stop();
  };

  const handleExitOrClose = () => {
    controllerRef.current?.stop();
    setSelectedItem(null);
    setStatus({
      state: "stopped",
      message: "Yayın durduruldu. Kanal veya radyo seçebilirsiniz.",
    });

    const androidBridge = (
      window as unknown as {
        AndroidBridge?: { exitApp?: () => void };
      }
    ).AndroidBridge;

    if (androidBridge && typeof androidBridge.exitApp === "function") {
      androidBridge.exitApp();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>('[data-tv-focus="true"]')
    );
    const currentIdx = focusable.indexOf(document.activeElement as HTMLElement);
    if (currentIdx === -1 || focusable.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusable[(currentIdx + 1) % focusable.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusable[(currentIdx - 1 + focusable.length) % focusable.length]?.focus();
    }
  };

  const q = searchQuery.trim().toLowerCase();

  const tvGroups = useMemo(() => {
    const filtered = q
      ? tvList.filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            (c.group || "").toLowerCase().includes(q)
        )
      : tvList;
    return groupItemsByCategory(filtered);
  }, [tvList, q]);

  const radioGroups = useMemo(() => {
    const filtered = q
      ? radioList.filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            (c.group || "").toLowerCase().includes(q)
        )
      : radioList;
    return groupItemsByCategory(filtered);
  }, [radioList, q]);

  const pageBg = darkTheme ? "#0b1017" : "#eef2f6";
  const pageFg = darkTheme ? "#f8fafc" : "#0f172a";
  const panelBg = darkTheme ? "#151d29" : "#ffffff";
  const itemBg = darkTheme ? "#1e293b" : "#f1f5f9";
  const btnBg = darkTheme ? "#2563eb" : "#1d4ed8";

  return (
    <div
      onKeyDown={handleKeyDown}
      style={{
        minHeight: "100vh",
        backgroundColor: pageBg,
        color: pageFg,
        padding: "12px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "15px",
        lineHeight: 1.45,
      }}
    >
      {/* 1. EN ÜST: Geniş Video Oynatıcı Alanı */}
      <section
        style={{
          backgroundColor: panelBg,
          borderRadius: "12px",
          padding: "10px",
          marginBottom: "12px",
          border: "1px solid rgba(148, 163, 184, 0.25)",
        }}
      >
        <video
          ref={mediaRef}
          controls
          playsInline
          autoPlay
          style={{
            width: "100%",
            height: "54vh",
            maxHeight: "520px",
            borderRadius: "8px",
            backgroundColor: "#000000",
            display: "block",
          }}
        />

        <div
          style={{
            marginTop: "8px",
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: "16px", fontWeight: 700, color: pageFg }}>
            {selectedItem ? selectedItem.title : "EYMEN TV & RADYO"}
          </div>
          <div
            style={{
              fontSize: "14px",
              color: darkTheme ? "#cbd5e1" : "#334155",
            }}
          >
            {status.message}
          </div>
        </div>
      </section>

      {/* 2. ORTA: Oynatıcının Altında Kontrol & Arama Menüsü */}
      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "14px",
          backgroundColor: panelBg,
          padding: "12px",
          borderRadius: "12px",
          border: "1px solid rgba(148, 163, 184, 0.25)",
        }}
      >
        <input
          data-tv-focus="true"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Kanal, radyo veya grup ara..."
          style={{
            padding: "10px 14px",
            fontSize: "15px",
            borderRadius: "8px",
            border: "1px solid #64748b",
            backgroundColor: darkTheme ? "#0f172a" : "#ffffff",
            color: pageFg,
            flex: "1 1 220px",
          }}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button
            data-tv-focus="true"
            onClick={handleManualFailover}
            disabled={!selectedItem || selectedItem.sources.length <= 1}
            style={{
              padding: "10px 14px",
              fontSize: "15px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "none",
              backgroundColor:
                !selectedItem || selectedItem.sources.length <= 1
                  ? "#475569"
                  : "#16a34a",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Yedek Kaynak ({selectedItem?.sources.length ?? 0})
          </button>

          <button
            data-tv-focus="true"
            onClick={handleStop}
            style={{
              padding: "10px 14px",
              fontSize: "15px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#d97706",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Durdur
          </button>

          <button
            data-tv-focus="true"
            onClick={() => setDarkTheme((d) => !d)}
            style={{
              padding: "10px 14px",
              fontSize: "15px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "none",
              backgroundColor: btnBg,
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            {darkTheme ? "Gündüz" : "Gece"}
          </button>

          <button
            data-tv-focus="true"
            onClick={handleExitOrClose}
            style={{
              padding: "10px 14px",
              fontSize: "15px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#dc2626",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Kapat / Çık
          </button>
        </div>
      </section>

      {/* 3. EN ALT: Gruplanmış Türkçe TV (Sol) ve Radyo (Sağ) Menüleri */}
      <main
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "14px",
        }}
      >
        <section
          style={{
            backgroundColor: panelBg,
            borderRadius: "12px",
            padding: "14px",
            border: "1px solid rgba(148, 163, 184, 0.25)",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px", color: pageFg }}>
            Türkçe TV Kanalları
          </h2>

          {tvGroups.length === 0 ? (
            <div style={{ padding: "12px", color: darkTheme ? "#cbd5e1" : "#334155" }}>
              Gösterilecek TV yayını bulunamadı.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {tvGroups.map(([groupName, items]) => (
                <div key={groupName}>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 700,
                      color: darkTheme ? "#93c5fd" : "#1d4ed8",
                      marginBottom: "6px",
                      paddingBottom: "4px",
                      borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
                    }}
                  >
                    {groupName} ({items.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {items.map((item) => {
                      const active = selectedItem?.id === item.id;
                      return (
                        <button
                          key={item.id}
                          data-tv-focus="true"
                          onClick={() => handleSelectItem(item)}
                          style={{
                            textAlign: "left",
                            padding: "11px 14px",
                            fontSize: "15px",
                            fontWeight: active ? 700 : 500,
                            borderRadius: "8px",
                            cursor: "pointer",
                            border: active ? "2px solid #60a5fa" : "1px solid #475569",
                            backgroundColor: active ? "#1d4ed8" : itemBg,
                            color: active ? "#ffffff" : pageFg,
                          }}
                        >
                          {item.title}
                          {item.sources.length > 1
                            ? ` • ${item.sources.length} kaynak`
                            : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          style={{
            backgroundColor: panelBg,
            borderRadius: "12px",
            padding: "14px",
            border: "1px solid rgba(148, 163, 184, 0.25)",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "18px", color: pageFg }}>
            Türkçe Radyolar
          </h2>

          {radioGroups.length === 0 ? (
            <div style={{ padding: "12px", color: darkTheme ? "#cbd5e1" : "#334155" }}>
              Gösterilecek radyo yayını bulunamadı.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {radioGroups.map(([groupName, items]) => (
                <div key={groupName}>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 700,
                      color: darkTheme ? "#6ee7b7" : "#047857",
                      marginBottom: "6px",
                      paddingBottom: "4px",
                      borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
                    }}
                  >
                    {groupName} ({items.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {items.map((item) => {
                      const active = selectedItem?.id === item.id;
                      return (
                        <button
                          key={item.id}
                          data-tv-focus="true"
                          onClick={() => handleSelectItem(item)}
                          style={{
                            textAlign: "left",
                            padding: "11px 14px",
                            fontSize: "15px",
                            fontWeight: active ? 700 : 500,
                            borderRadius: "8px",
                            cursor: "pointer",
                            border: active ? "2px solid #34d399" : "1px solid #475569",
                            backgroundColor: active ? "#047857" : itemBg,
                            color: active ? "#ffffff" : pageFg,
                          }}
                        >
                          {item.title}
                          {item.sources.length > 1
                            ? ` • ${item.sources.length} kaynak`
                            : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
