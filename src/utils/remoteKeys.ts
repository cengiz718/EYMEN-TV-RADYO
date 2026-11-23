export type RemoteDirection = 'up' | 'down' | 'left' | 'right';

export interface RemoteKeyLike {
  key: string;
  keyCode: number;
  which?: number;
}

declare global {
  interface Window {
    __IS_ANDROID_TV__?: boolean;
    __eymenRemoteKey?: (key: string, keyCode: number) => boolean;
    Android?: {
      exitApp?: () => void;
      openExternalUrl?: (url: string) => void;
      showSoftKeyboard?: () => void;
    };
  }
}

export function isTextInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(type);
  }
  return false;
}

export function getRemoteDirection(e: RemoteKeyLike): RemoteDirection | null {
  const k = e.key;
  const c = e.keyCode || e.which || 0;
  if (k === 'ArrowUp' || k === 'Up' || c === 38 || c === 19) return 'up';
  if (k === 'ArrowDown' || k === 'Down' || c === 40 || c === 20) return 'down';
  if (k === 'ArrowLeft' || k === 'Left' || c === 37 || c === 21) return 'left';
  if (k === 'ArrowRight' || k === 'Right' || c === 39 || c === 22) return 'right';
  return null;
}

export function isRemoteSelectKey(e: RemoteKeyLike): boolean {
  const k = e.key;
  const c = e.keyCode || e.which || 0;
  return (
    k === 'Enter' ||
    k === 'NumpadEnter' ||
    k === 'Select' ||
    k === 'DPadCenter' ||
    k === 'Execute' ||
    k === ' ' ||
    k === 'Spacebar' ||
    c === 13 ||
    c === 23 ||
    c === 66 ||
    c === 160
  );
}

export function isRemoteBackKey(e: RemoteKeyLike, isTyping = false): boolean {
  const k = e.key;
  const c = e.keyCode || e.which || 0;
  if (
    k === 'Escape' ||
    k === 'GoBack' ||
    k === 'BrowserBack' ||
    k === 'Back' ||
    c === 4 ||
    c === 27 ||
    c === 461
  ) {
    return true;
  }
  if (!isTyping && (k === 'Backspace' || c === 8)) {
    return true;
  }
  return false;
}

export function isRemoteMenuKey(e: RemoteKeyLike): boolean {
  const k = e.key;
  const c = e.keyCode || e.which || 0;
  return (
    k === 'ContextMenu' ||
    k === 'Menu' ||
    k === 'Guide' ||
    c === 82 ||
    c === 172
  );
}

export function isRemoteChannelUpKey(e: RemoteKeyLike): boolean {
  const k = e.key;
  const c = e.keyCode || e.which || 0;
  return (
    k === 'ChannelUp' ||
    k === 'MediaTrackNext' ||
    k === 'PageUp' ||
    k === 'F9' ||
    c === 166 ||
    c === 87
  );
}

export function isRemoteChannelDownKey(e: RemoteKeyLike): boolean {
  const k = e.key;
  const c = e.keyCode || e.which || 0;
  return (
    k === 'ChannelDown' ||
    k === 'MediaTrackPrevious' ||
    k === 'PageDown' ||
    k === 'F10' ||
    c === 167 ||
    c === 88
  );
}

export function isRemoteMediaPlayPause(e: RemoteKeyLike): 'play' | 'pause' | 'toggle' | null {
  const k = e.key;
  const c = e.keyCode || e.which || 0;
  if (k === 'MediaPlay' || c === 126) return 'play';
  if (k === 'MediaPause' || c === 127) return 'pause';
  if (k === 'MediaPlayPause' || c === 85 || c === 179) return 'toggle';
  return null;
}

export function isRemoteFastForward(e: RemoteKeyLike): boolean {
  return e.key === 'MediaFastForward' || e.keyCode === 90;
}

export function isRemoteRewind(e: RemoteKeyLike): boolean {
  return e.key === 'MediaRewind' || e.keyCode === 89;
}

export function isAnyRemoteNavigationKey(e: RemoteKeyLike): boolean {
  return Boolean(
    getRemoteDirection(e) ||
      isRemoteSelectKey(e) ||
      isRemoteBackKey(e, false) ||
      isRemoteMenuKey(e) ||
      isRemoteChannelUpKey(e) ||
      isRemoteChannelDownKey(e) ||
      isRemoteMediaPlayPause(e) ||
      isRemoteFastForward(e) ||
      isRemoteRewind(e) ||
      e.key === 'Tab'
  );
}

export function isTvEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__IS_ANDROID_TV__) return true;
  const ua = navigator.userAgent || '';
  return /Android\s+TV|GoogleTV|AFT[A-Z0-9]|MIBOX|MiTV|BRAVIA|SmartTV|Tizen|Web0S|Leanback/i.test(
    ua
  );
}

export function triggerElementActivation(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false;
  const interactive = el.closest<HTMLElement>(
    'button:not(:disabled), [role="button"], a[href], input[type="checkbox"], input[type="radio"], summary'
  );
  const target = interactive ?? el;
  if (target.hasAttribute('disabled')) return false;

  if (
    target.tagName === 'BUTTON' ||
    target.getAttribute('role') === 'button' ||
    target.tagName === 'A' ||
    target.tagName === 'SUMMARY' ||
    (target.tagName === 'INPUT' &&
      ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(
        ((target as HTMLInputElement).type || '').toLowerCase()
      ))
  ) {
    target.click();
    return true;
  }
  return false;
}

export function installRemoteBridge(): () => void {
  const dispatchSyntheticKey = (key: string, keyCode: number): boolean => {
    document.body.classList.add('tv-remote-active');
    const active = document.activeElement as HTMLElement | null;

    // If user presses OK / Enter on an input field inside Android TV WebView, open soft keyboard
    if (
      (key === 'DPadCenter' || key === 'Enter' || key === 'Select' || keyCode === 23) &&
      active &&
      isTextInputElement(active)
    ) {
      active.focus();
      try {
        window.Android?.showSoftKeyboard?.();
      } catch {
        // ignore
      }
      return true;
    }

    const target: EventTarget =
      active && active !== document.body && active.isConnected ? active : window;
    const ev = new KeyboardEvent('keydown', {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
    });
    // Ensure legacy keyCode/which getters match Android keyCode
    try {
      Object.defineProperty(ev, 'keyCode', { value: keyCode });
      Object.defineProperty(ev, 'which', { value: keyCode });
    } catch {
      // ignore if read-only in strict browser
    }
    target.dispatchEvent(ev);
    return true;
  };

  window.__eymenRemoteKey = dispatchSyntheticKey;
  return () => {
    if (window.__eymenRemoteKey === dispatchSyntheticKey) {
      delete window.__eymenRemoteKey;
    }
  };
}
