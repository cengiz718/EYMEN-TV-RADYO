import React, { useEffect, useRef, useState } from "react";
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
      id: "tv-sample-1",
      title: "TRT 1",
      category: "tv",
      group: "Ulusal TV",
      sources: [
        {
          id: "tv-sample-1-s1",
          label: "Ana Yayın",
          url: "https://tv-trt1.medya.trt.com.tr/master.m3u8",
          priority: 1,
        },
      ],
    },
    {
      id: "tv-sample-2",
      title: "TRT Haber",
      category: "tv",
      group: "Haber",
      sources: [
        {
          id: "tv-sample-2-s1",
          label: "Ana Yayın",
          url: "https://tv-trthaber.medya.trt.com.tr/master.m3u8",
          priority: 1,
        },
      ],
    },
  ],
  radio: [
    {
      id: "radio-sample-1",
      title: "TRT Radyo 1",
      category: "radio",
      group: "Radyo",
      sources: [
        {
          id: "radio-sample-1-s1",
          label: "Ana Yayın",
          url: "https://radio-trtradyo1.medya.trt.com.tr/master.m3u8",
          priority: 1,
        },
      ],
    },
    {
      id: "radio-sample-2",
      title: "TRT Türkü",
      category: "radio",
      group: "Türkü",
      sources: [
        {
          id: "radio-sample-2-s1",
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

export default function App() {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<EymenStreamController | null>(null);

  const [tvList, setTvList] = useState<MediaItem[]>(FALLBACK_CATALOG.tv);
  const [radioList, setRadioList] = useState<MediaItem[]>(FALLBACK_CATALOG.radio);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [status, setStatus] = useState<StreamStatusEvent>({
    state: "idle",
    message: "Bir TV veya Radyo yayını seçin",
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>('[data-tv-focus="true"]')
    );
    const currentIdx = focusable.indexOf(document.activeElement as HTMLElement);
    if (currentIdx === -1) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusable[(currentIdx + 1) % focusable.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusable[(currentIdx - 1 + focusable.length) % focusable.length]?.focus();
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredTv = q
    ? tvList.filter((c) => c.title.toLowerCase().includes(q))
    : tvList;
  const filteredRadio = q
    ? radioList.filter((c) => c.title.toLowerCase().includes(q))
    : radioList;

  return (
    <div
      onKeyDown={handleKeyDown}
      style={{
        minHeight: "100vh",
        background: darkTheme ? "#0f141c" : "#f3f5f8",
        color: darkTheme ? "#eef2f7" : "#141820",
        padding: "16px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap
