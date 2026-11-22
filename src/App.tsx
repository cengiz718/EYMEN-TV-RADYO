import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  EymenStreamController,
  loadAllCatalogs,
  MediaCategory,
  MediaItem,
  StreamStatusEvent,
} from "./streamManager";

const CATALOG_URLS = {
  // Repoda bulunan ana M3U listesinden TV ve radyo ayrı ayrı ayrıştırılır.
  tv: ["https://raw.githubusercontent.com/cengiz718/EYMEN-TV-RADYO/main/public/playlist.m3u8"],
  radio: ["https://raw.githubusercontent.com/cengiz718/EYMEN-TV-RADYO/main/public/playlist.m3u8"],
};

const FALLBACK_CATALOG: Record<MediaCategory, MediaItem[]> = {
  tv: [
    { id: "tv-1", title: "TRT 1", category: "tv", group: "Ulusal", sources: [{ id: "tv-1-s1", label: "Ana Yayın", url: "https://tv-trt1.medya.trt.com.tr/master.m3u8", priority: 1 }] },
    { id: "tv-2", title: "TRT Haber", category: "tv", group: "Haber", sources: [{ id: "tv-2-s1", label: "Ana Yayın", url: "https://tv-trthaber.medya.trt.com.tr/master.m3u8", priority: 1 }] },
    { id: "tv-3", title: "TRT Spor", category: "tv", group: "Spor", sources: [{ id: "tv-3-s1", label: "Ana Yayın", url: "https://tv-trtspor.medya.trt.com.tr/master.m3u8", priority: 1 }] },
  ],
  radio: [
    { id: "radio-1", title: "TRT Radyo 1", category: "radio", group: "Haber & Spor", sources: [{ id: "radio-1-s1", label: "Ana Yayın", url: "https://radio-trtradyo1.medya.trt.com.tr/master.m3u8", priority: 1 }] },
    { id: "radio-2", title: "TRT Türkü", category: "radio", group: "Türkü & Halk Müziği", sources: [{ id: "radio-2-s1", label: "Ana Yayın", url: "https://radio-trtturku.medya.trt.com.tr/master.m3u8", priority: 1 }] },
  ],
  movie: [],
  series: [],
};

function groupItems(items: MediaItem[]): Array<[string, MediaItem[]]> {
  const map = new Map<string, MediaItem[]>();
  items.forEach((item) => {
    const group = item.group?.trim() || "Genel";
    if (!map.has(group)) map.set(group, []);
    map.get(group)!.push(item);
  });
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "tr"));
}

export default function App() {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<EymenStreamController | null>(null);
  const [tvList, setTvList] = useState<MediaItem[]>(FALLBACK_CATALOG.tv);
  const [radioList, setRadioList] = useState<MediaItem[]>(FALLBACK_CATALOG.radio);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [status, setStatus] = useState<StreamStatusEvent>({ state: "idle", message: "Bir yayın seçerek başlayın" });
  const [searchQuery, setSearchQuery] = useState("");
  const [darkTheme, setDarkTheme] = useState(true);
  const [activeTab, setActiveTab] = useState<"tv" | "radio">("tv");

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const controller = new EymenStreamController(el, { failoverTimeoutMs: 5000, onStatus: setStatus });
    controllerRef.current = controller;
    void loadAllCatalogs(CATALOG_URLS, FALLBACK_CATALOG).then((catalog) => {
      if (catalog.tv.length) setTvList(catalog.tv);
      if (catalog.radio.length) setRadioList(catalog.radio);
    });
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  const selectItem = (item: MediaItem) => {
    setSelectedItem(item);
    controllerRef.current?.playItem(item, 0);
  };

  const stop = () => controllerRef.current?.stop();

  const exitApp = () => {
    controllerRef.current?.stop();
    const bridge = (window as unknown as { AndroidBridge?: { exitApp?: () => void } }).AndroidBridge;
    bridge?.exitApp?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-tv-focus='true']"));
    const index = elements.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      elements[(index + 1) % elements.length]?.focus();
    }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      elements[(index - 1 + elements.length) % elements.length]?.focus();
    }
    if (e.key === "Enter" && document.activeElement instanceof HTMLElement) document.activeElement.click();
  };

  const q = searchQuery.trim().toLocaleLowerCase("tr");
  const filteredTv = q ? tvList.filter((x) => x.title.toLocaleLowerCase("tr").includes(q) || (x.group || "").toLocaleLowerCase("tr").includes(q)) : tvList;
  const filteredRadio = q ? radioList.filter((x) => x.title.toLocaleLowerCase("tr").includes(q) || (x.group || "").toLocaleLowerCase("tr").includes(q)) : radioList;
  const groups = groupItems(activeTab === "tv" ? filteredTv : filteredRadio);
  const total = tvList.length + radioList.length;
  const isPlaying = status.state === "playing" || status.state === "loading";

  return (
    <div className={`eymen-shell ${darkTheme ? "theme-dark" : "theme-light"}`} onKeyDown={handleKeyDown}>
      <header className="eymen-header">
        <div className="eymen-brand">
          <div className="eymen-logo" aria-hidden="true"><span>ET</span></div>
          <div>
            <div className="eymen-brand-title">EYMEN <strong>TV</strong></div>
            <div className="eymen-brand-subtitle">TELEVİZYON • RADYO • CANLI YAYIN</div>
          </div>
        </div>
        <div className="eymen-header-actions">
          <div className={`eymen-live-indicator ${isPlaying ? "is-live" : ""}`}><span /> {isPlaying ? "CANLI" : "HAZIR"}</div>
          <button data-tv-focus="true" className="icon-button" onClick={() => setDarkTheme((v) => !v)} aria-label="Tema değiştir">{darkTheme ? "☀️" : "🌙"}</button>
          <button data-tv-focus="true" className="exit-button" onClick={exitApp}>⏻ ÇIKIŞ</button>
        </div>
      </header>

      <section className="eymen-hero">
        <div className="eymen-player-wrap">
          <video ref={mediaRef} controls playsInline autoPlay className="eymen-player" />
          <div className="eymen-player-badge"><span className="pulse-dot" /> {isPlaying ? "YAYIN AKIYOR" : "YAYIN BEKLENİYOR"}</div>
          {selectedItem && <div className="eymen-now-playing"><div className="now-icon">{selectedItem.category === "radio" ? "🎵" : "📺"}</div><div><span>ŞU ANDA OYNATILIYOR</span><strong>{selectedItem.title}</strong></div></div>}
        </div>
        <div className="eymen-player-footer">
          <div><span className="eymen-kicker">EYMEN PLAYER</span><h1>{selectedItem?.title || "Canlı yayın merkezi"}</h1><p>{status.message}</p></div>
          <div className="eymen-status-box"><span className={`status-dot status-${status.state}`} /><span>{status.state === "playing" ? "Bağlantı aktif" : status.state === "loading" ? "Bağlanıyor…" : "Yayın seçilmedi"}</span></div>
        </div>
      </section>

      <section className="eymen-toolbar">
        <div className="search-box">
          <span>⌕</span>
          <input data-tv-focus="true" type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Kanal veya radyo ara..." />
          {searchQuery && <button data-tv-focus="true" className="clear-search" onClick={() => setSearchQuery("")}>×</button>}
        </div>
        <div className="toolbar-actions">
          <button data-tv-focus="true" className="tool-button secondary" onClick={() => controllerRef.current?.cycleSourceManual()} disabled={!selectedItem || selectedItem.sources.length < 2}>↻ Yedek kaynak</button>
          <button data-tv-focus="true" className="tool-button warning" onClick={stop}>■ Durdur</button>
          <button data-tv-focus="true" className="tool-button" onClick={() => setDarkTheme((v) => !v)}>{darkTheme ? "☀️ Açık tema" : "🌙 Koyu tema"}</button>
        </div>
      </section>

      <main className="eymen-main-layout">
        <section className="eymen-library-panel">
          <div className="panel-heading">
            <div className="panel-icon movie-icon">▶</div>
            <div><span className="eymen-kicker">ARŞİV</span><h2>FİLM & DİZİ</h2><p>İçerik bölümü</p></div>
          </div>
          <div className="archive-cards">
            <div className="archive-card"><span>🎬</span><strong>Filmler</strong><small>0 içerik</small></div>
            <div className="archive-card"><span>📺</span><strong>Diziler</strong><small>0 içerik</small></div>
          </div>
          <div className="archive-empty"><div className="empty-symbol">✦</div><strong>İçerik bağlantıları temizlendi</strong><p>Film ve dizi yayın linkleri bu sürümden kaldırıldı. Doğrulanmış içerik eklenene kadar bu alan pasif kalır.</p></div>
          <div className="panel-note">Güvenli içerik yönetimi <span>•</span> Hazır</div>
        </section>

        <section className="eymen-live-panel">
          <div className="panel-heading live-heading">
            <div className="panel-icon live-icon">◉</div>
            <div><span className="eymen-kicker">CANLI YAYIN</span><h2>TV & RADYO</h2><p>{total} yayın noktası</p></div>
            <div className="count-badge">{activeTab === "tv" ? tvList.length : radioList.length}</div>
          </div>

          <div className="media-tabs" role="tablist">
            <button data-tv-focus="true" className={`media-tab tv-tab ${activeTab === "tv" ? "active" : ""}`} role="tab" aria-selected={activeTab === "tv"} onClick={() => setActiveTab("tv")}><span>📺</span><b>TELEVİZYON</b><em>{tvList.length}</em></button>
            <button data-tv-focus="true" className={`media-tab radio-tab ${activeTab === "radio" ? "active" : ""}`} role="tab" aria-selected={activeTab === "radio"} onClick={() => setActiveTab("radio")}><span>🎵</span><b>RADYO</b><em>{radioList.length}</em></button>
          </div>

          <div className="channel-area">
            {groups.length === 0 ? <div className="no-results"><span>⌕</span><strong>Sonuç bulunamadı</strong><p>Arama metnini değiştirip tekrar deneyin.</p></div> :
              groups.map(([groupName, items]) => (
                <div className="channel-group" key={groupName}>
                  <div className="group-title"><span>{groupName}</span><em>{items.length}</em></div>
                  <div className="channel-grid">
                    {items.map((item) => {
                      const active = selectedItem?.id === item.id;
                      return <button key={item.id} data-tv-focus="true" className={`channel-card ${active ? "selected" : ""}`} onClick={() => selectItem(item)}>
                        <span className="channel-logo">{item.category === "radio" ? "♪" : "TV"}</span>
                        <span className="channel-name">{item.title}</span>
                        {active && <span className="playing-mark"><i /><i /><i /></span>}
                      </button>;
                    })}
                  </div>
                </div>
              ))
            }
          </div>
        </section>
      </main>

      <footer className="eymen-footer">
        <span>EYMEN TV & RADYO</span><span>Profesyonel canlı yayın arayüzü</span><span>TV: {tvList.length} • Radyo: {radioList.length}</span>
      </footer>
    </div>
  );
}
