import { useEffect, useRef } from 'react';

export function useIdleAutoClose(
  isOpen: boolean,
  seconds: number,
  onClose: () => void,
  paused = false,
  allowOnTouch = false
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || paused || seconds <= 0) return;

    const isTouchPrimary =
      typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse)').matches &&
      !document.body.classList.contains('tv-remote-active');
    if (isTouchPrimary && !allowOnTouch) {
      return;
    }

    let timerId: number | null = null;
    let lastMoveReset = 0;

    const isTypingInForm = (): boolean => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return false;
      const tag = active.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable) {
        return true;
      }
      if (tag === 'INPUT') {
        const type = (active as HTMLInputElement).type;
        return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type);
      }
      return false;
    };

    const armTimer = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        if (isTypingInForm()) {
          armTimer();
          return;
        }
        onCloseRef.current();
      }, seconds * 1000);
    };

    const handleActivity = (e: Event) => {
      if (e.type === 'mousemove') {
        const now = Date.now();
        if (now - lastMoveReset < 450) return;
        lastMoveReset = now;
      }
      armTimer();
    };

    armTimer();

    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'touchstart',
      'keydown',
      'input',
      'change',
      'wheel',
      'scroll',
      'mousemove',
    ];

    for (const ev of events) {
      window.addEventListener(ev, handleActivity, true);
    }

    return () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      for (const ev of events) {
        window.removeEventListener(ev, handleActivity, true);
      }
    };
  }, [isOpen, seconds, paused, allowOnTouch]);
}
