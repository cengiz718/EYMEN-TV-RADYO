export interface AppErrorEntry {
  id: string;
  timestamp: string;
  source: 'runtime' | 'player' | 'network' | 'react';
  message: string;
  detail?: string;
}

const STORAGE_ERROR_LOG_KEY = 'eymen_error_logs_v1';
const MAX_ERROR_LOGS = 50;

export function loadErrorLogs(): AppErrorEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_ERROR_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AppErrorEntry[]) : [];
  } catch {
    return [];
  }
}

export function logAppError(
  source: AppErrorEntry['source'],
  message: string,
  detail?: string
): void {
  try {
    const cleanMsg = String(message || 'Bilinmeyen hata').slice(0, 260);
    const cleanDetail = detail ? String(detail).slice(0, 320) : undefined;
    const entry: AppErrorEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      source,
      message: cleanMsg,
      detail: cleanDetail,
    };
    const existing = loadErrorLogs();
    const next = [entry, ...existing].slice(0, MAX_ERROR_LOGS);
    localStorage.setItem(STORAGE_ERROR_LOG_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

export function clearErrorLogs(): void {
  try {
    localStorage.removeItem(STORAGE_ERROR_LOG_KEY);
  } catch {
    // ignore
  }
}
