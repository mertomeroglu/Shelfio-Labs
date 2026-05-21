import { useEffect, useRef, useState } from 'react';
import { playNotificationTone } from '../utils/notificationSound.js';
import { normalizeTurkishText } from '../utils/turkishText.js';

let lastPlayTime = 0;

const NOTIFICATION_SOUND_ENABLED_KEY = 'shelfio.toast.sound.enabled';
const NOTIFICATION_SOUND_VOLUME_KEY = 'shelfio.toast.sound.volume';

function readSoundSettings() {
  if (typeof window === 'undefined') {
    return { enabled: true, volume: 0.4 };
  }

  try {
    const enabled = window.localStorage.getItem(NOTIFICATION_SOUND_ENABLED_KEY) !== 'false';
    const storedVolume = Number(window.localStorage.getItem(NOTIFICATION_SOUND_VOLUME_KEY));
    const normalizedVolume = Number.isFinite(storedVolume) ?
      Math.max(0, Math.min(1, storedVolume / 100))
      : 0.4;

    return { enabled, volume: normalizedVolume };
  } catch {
    return { enabled: true, volume: 0.4 };
  }
}

async function playNotificationSound() {
  const { enabled, volume } = readSoundSettings();
  if (!enabled) return;

  const now = Date.now();
  if (now - lastPlayTime < 1500) return;

  lastPlayTime = now;
  await playNotificationTone(Math.round(volume * 100));
}

export default function Toast({ toast, onClose, className = '' }) {
  const [fading, setFading] = useState(false);
  const prevToastRef = useRef(null);

  useEffect(() => {
    if (!toast) {
      setFading(false);
      return undefined;
    }

    if (toast !== prevToastRef.current) {
      playNotificationSound();
      prevToastRef.current = toast;
    }

    setFading(false);

    const fadeTimer = window.setTimeout(() => {
      setFading(true);
    }, 3000);

    const removeTimer = window.setTimeout(() => {
      onClose?.();
    }, 3400);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [onClose, toast]);

  if (!toast) {
    return null;
  }

  const title = normalizeTurkishText(toast.title || 'Bilgi');
  const message = normalizeTurkishText(toast.message || '');

  return (
    <div className={`toast ${toast.type || 'info'}${fading ? ' toast-fade-out' : ''} ${className}`.trim()}>
      <strong>{title}</strong>
      <span>{message}</span>
      <button type="button" onClick={() => { setFading(true); setTimeout(() => onClose?.(), 400); }}>
        ×
      </button>
    </div>
  );
}
