import { useEffect, useState } from 'react';
import { Bell, BellRing, CalendarClock, X } from 'lucide-react';
import type { Channel, EpgProgrammeItem, EpgReminderItem } from '../types/channel';
import { computeEpgProgress, formatEpgTime } from '../utils/epg';
import { useIdleAutoClose } from '../hooks/useIdleAutoClose';

interface EpgScheduleModalProps {
  isOpen: boolean;
  channel: Channel | null;
  epgUrl?: string;
  menuAutoCloseSeconds?: number;
  reminders?: EpgReminderItem[];
  onToggleReminder?: (item: EpgReminderItem) => void;
  onClose: () => void;
}

export function EpgScheduleModal({
  isOpen,
  channel,
  epgUrl,
  menuAutoCloseSeconds = 5,
  reminders = [],
  onToggleReminder,
  onClose,
}: EpgScheduleModalProps) {
  const [programmes, setProgrammes] = useState<EpgProgrammeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useIdleAutoClose(Boolean(isOpen && channel), menuAutoCloseSeconds, onClose, isLoading);

  useEffect(() => {
    if (!isOpen || !channel) return;
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ name: channel.name });
        if (epgUrl?.trim()) params.set('url', epgUrl.trim());
        const res = await fetch(`/api/epg/channel?${params.toString()}`);
        const data = (await res.json()) as { programmes?: EpgProgrammeItem[] };
        if (!cancelled) {
          setProgrammes(data.programmes || []);
        }
      } catch {
        if (!cancelled) setProgrammes([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, channel, epgUrl]);

  if (!isOpen || !channel) return null;

  const now = Date.now();
  const reminderIds = new Set(reminders.map((r) => r.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md max-h-[82dvh] flex flex-col rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--surface-2)] border-b border-[var(--border)]">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarClock className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-[var(--ink)] truncate">
                {channel.name} — Yayın Akışı (EPG)
              </h2>
              <p className="text-[11px] text-[var(--muted)]">
                Şimdi ne var, sonra ne var? · Program hatırlatıcı
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto touch-scroll-y p-3 space-y-2">
          {isLoading ? (
            <div className="py-12 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full border-3 border-[var(--accent)]/25 border-t-[var(--accent)] animate-spin" />
            </div>
          ) : programmes.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--muted)]">
              Bu kanal için online EPG yayın akışı bulunamadı.
            </div>
          ) : (
            programmes.map((p, idx) => {
              const isLive = p.startMs <= now && p.stopMs > now;
              const isFuture = p.startMs > now;
              const pct = isLive ? computeEpgProgress(p.startMs, p.stopMs) : 0;
              const remId = `${channel.id}_${p.startMs}`;
              const hasReminder = reminderIds.has(remId);
              return (
                <div
                  key={`${p.startMs}_${idx}`}
                  className={`rounded-xl border p-3 ${
                    isLive
                      ? 'bg-[var(--surface-elevated)] border-[var(--accent)]'
                      : 'bg-[var(--bg)] border-[var(--border)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className={`font-mono-nums font-bold ${
                        isLive ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
                      }`}
                    >
                      {formatEpgTime(p.startMs)} – {formatEpgTime(p.stopMs)}
                    </span>
                    {isLive ? (
                      <span className="text-[11px] font-extrabold text-[var(--accent)] uppercase tracking-wide">
                        ŞİMDİ YAYINDA
                      </span>
                    ) : isFuture && onToggleReminder ? (
                      <button
                        type="button"
                        onClick={() =>
                          onToggleReminder({
                            id: remId,
                            channelId: channel.id,
                            channelName: channel.name,
                            title: p.title,
                            startMs: p.startMs,
                            stopMs: p.stopMs,
                          })
                        }
                        className={`touch-compact flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold transition-colors ${
                          hasReminder
                            ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                            : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]'
                        }`}
                      >
                        {hasReminder ? (
                          <>
                            <BellRing className="w-3 h-3" />
                            <span>Hatırlatılıyor</span>
                          </>
                        ) : (
                          <>
                            <Bell className="w-3 h-3" />
                            <span>Hatırlat</span>
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[13px] font-semibold text-[var(--ink)]">
                    {p.title}
                  </div>
                  {p.desc && (
                    <div className="mt-1 text-xs text-[var(--muted)] line-clamp-2">
                      {p.desc}
                    </div>
                  )}
                  {isLive && (
                    <div className="mt-2 h-1.5 w-full rounded bg-[var(--bg)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
