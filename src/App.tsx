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
  const [activeRightTab, setActiveRightTab] = useState<"tv" | "radio">("tv");

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
      className="eymen-shell"
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
        className="eymen-player-card"
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
        className="eymen-controls"
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
          placeholder="TV kanalı veya radyo ara..."
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

      {/* 3. AYRILMIŞ ALANLAR: Film/Dizi solda, TV/Radyo sağda */}
      <main className="eymen-content eymen-main-layout">
        <section className="eymen-library-panel" style={{
          backgroundColor: panelBg,
          borderRadius: "16px",
          padding: "16px",
          border: "1px solid rgba(148, 163, 184, 0.25)",
          minWidth: 0,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"16px"}}>
            <div aria-hidden="true" style={{fontSize:"26px"}}>🎬</div>
            <div>
              <h2 style={{margin:0,fontSize:"19px",fontWeight:800,color:pageFg}}>FİLM & DİZİ</h2>
              <div style={{fontSize:"12px",color:darkTheme?"#94a3b8":"#64748b"}}>Sol bölüm · Film ve dizi arşivi</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:"10px",marginBottom:"16px"}}>
            <div style={{background:itemBg,border:"1px solid rgba(148,163,184,.22)",borderRadius:"12px",padding:"14px",minHeight:"92px"}}>
              <div style={{fontSize:"23px",marginBottom:"5px"}}>🎞️</div>
              <div style={{fontWeight:800,color:pageFg}}>Filmler</div>
              <div style={{fontSize:"11px",color:darkTheme?"#94a3b8":"#64748b"}}>Yayın listesi boş</div>
            </div>
            <div style={{background:itemBg,border:"1px solid rgba(148,163,184,.22)",borderRadius:"12px",padding:"14px",minHeight:"92px"}}>
              <div style={{fontSize:"23px",marginBottom:"5px"}}>📺</div>
              <div style={{fontWeight:800,color:pageFg}}>Diziler</div>
              <div style={{fontSize:"11px",color:darkTheme?"#94a3b8":"#64748b"}}>Yayın listesi boş</div>
            </div>
          </div>
          <div style={{
            border:"1px dashed rgba(148,163,184,.38)",
            borderRadius:"12px",
            padding:"18px 14px",
            textAlign:"center",
            background:darkTheme?"rgba(15,23,42,.55)":"rgba(241,245,249,.75)",
          }}>
            <div style={{fontSize:"28px",marginBottom:"8px"}}>🧹</div>
            <div style={{fontWeight:750,color:pageFg,marginBottom:"5px"}}>Film ve dizi yayın bağlantıları kaldırıldı</div>
            <div style={{fontSize:"12px",lineHeight:1.55,color:darkTheme?"#cbd5e1":"#475569"}}>
              Beğenmediğin film/dizi yayınları bu ekranda gösterilmiyor. Doğrulanmış yeni bir liste eklenene kadar bu bölüm boş kalacak.
            </div>
          </div>
        </section>

        <section className="eymen-live-panel" style={{
          backgroundColor: panelBg,
          borderRadius: "16px",
          padding: "14px",
          border: "1px solid rgba(148, 163, 184, 0.25)",
          minWidth: 0,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"12px"}}>
            <div aria-hidden="true" style={{fontSize:"26px"}}>📡</div>
            <div>
              <h2 style={{margin:0,fontSize:"19px",fontWeight:800,color:pageFg}}>TV & RADYO</h2>
              <div style={{fontSize:"12px",color:darkTheme?"#94a3b8":"#64748b"}}>Sağ bölüm · Canlı yayınlar</div>
            </div>
          </div>

          <div role="tablist" aria-label="Canlı yayın türü" style={{
            display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",
            padding:"5px",borderRadius:"12px",background:darkTheme?"#0f172a":"#e2e8f0",
            marginBottom:"14px",
          }}>
            <button type="button" role="tab" aria-selected={activeRightTab==="tv"}
              data-tv-focus="true" onClick={()=>setActiveRightTab("tv")}
              style={{padding:"11px 8px",border:0,borderRadius:"9px",fontWeight:800,
                background:activeRightTab==="tv"?"#2563eb":"transparent",
                color:activeRightTab==="tv"?"#fff":pageFg,cursor:"pointer"}}>
              📺 TELEVİZYON ({tvGroups.reduce((n,[,items])=>n+items.length,0)})
            </button>
            <button type="button" role="tab" aria-selected={activeRightTab==="radio"}
              data-tv-focus="true" onClick={()=>setActiveRightTab("radio")}
              style={{padding:"11px 8px",border:0,borderRadius:"9px",fontWeight:800,
                background:activeRightTab==="radio"?"#047857":"transparent",
                color:activeRightTab==="radio"?"#fff":pageFg,cursor:"pointer"}}>
              🎵 RADYO ({radioGroups.reduce((n,[,items])=>n+items.length,0)})
            </button>
          </div>

          {(() => {
            const groups = activeRightTab === "tv" ? tvGroups : radioGroups;
            const accent = activeRightTab === "tv" ? (darkTheme?"#93c5fd":"#1d4ed8") : (darkTheme?"#6ee7b7":"#047857");
            return groups.length === 0 ? (
              <div style={{padding:"14px",color:darkTheme?"#cbd5e1":"#334155"}}>
                {activeRightTab === "tv" ? "Gösterilecek TV yayını bulunamadı." : "Gösterilecek radyo yayını bulunamadı."}
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
                {groups.map(([groupName,items])=>(
                  <div key={groupName}>
                    <div style={{fontSize:"13px",fontWeight:800,color:accent,marginBottom:"7px",
                      paddingBottom:"5px",borderBottom:"1px solid rgba(148,163,184,.2)"}}>
                      {groupName} ({items.length})
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:"7px"}}>
                      {items.map(item=>{
                        const active=selectedItem?.id===item.id;
                        return <button key={item.id} type="button" data-tv-focus="true"
                          onClick={()=>handleSelectItem(item)}
                          style={{textAlign:"left",padding:"11px 12px",minHeight:"44px",
                            fontSize:"14px",fontWeight:active?800:600,borderRadius:"10px",
                            cursor:"pointer",border:active?"2px solid #60a5fa":"1px solid #475569",
                            backgroundColor:active?(activeRightTab==="tv"?"#1d4ed8":"#047857"):itemBg,
                            color:active?"#fff":pageFg}}>
                          {item.title}{item.sources.length>1? ` · ${item.sources.length} kaynak`:""}
                        </button>;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </section>
      </main>
    </div>
  );
}
