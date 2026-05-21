import notificationToneUrl from '../assets/notify.wav';

let preloadPromise = null;
let unlockHandlersBound = false;
let activeAudio = null;
let lastTriggerAtMs = 0;

const DEBOUNCE_MS = 220;
const NOTIFICATION_SOUND_PATH = notificationToneUrl;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const clearActivePlayback = () => {
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch {
      // Sessiz fallback.
    }
  }
  activeAudio = null;
};

const createAudioElement = () => {
  if (typeof window === 'undefined' || typeof window.Audio === 'undefined') {
    return null;
  }

  const audio = new window.Audio(NOTIFICATION_SOUND_PATH);
  audio.preload = 'auto';
  return audio;
};

const bindUnlockHandlers = () => {
  if (unlockHandlersBound || typeof window === 'undefined') {
    return;
  }

  unlockHandlersBound = true;

  const unlock = () => {
    const probe = createAudioElement();
    if (!probe) {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
      return;
    }

    probe.volume = 0;
    probe.play().catch(() => {}).finally(() => {
      try {
        probe.pause();
        probe.currentTime = 0;
      } catch {
        // Sessiz fallback.
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    });
  };

  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('touchstart', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true, passive: true });
};

export function preloadNotificationTone() {
  bindUnlockHandlers();

  if (!preloadPromise) {
    preloadPromise = Promise.resolve().then(() => {
      const probe = createAudioElement();
      if (!probe) return;

      probe.volume = 0;
      return new Promise((resolve) => {
        const done = () => resolve();
        probe.addEventListener('canplaythrough', done, { once: true });
        probe.addEventListener('error', done, { once: true });

        try {
          probe.load();
        } catch {
          resolve();
        }
      });
    }).catch(() => {
      // Sessiz fallback.
    });
  }

  return preloadPromise;
}

export async function playNotificationTone(volumePercent = 40) {
  const nowMs = Date.now();
  if (nowMs - lastTriggerAtMs < DEBOUNCE_MS) {
    return;
  }
  lastTriggerAtMs = nowMs;

  bindUnlockHandlers();
  await preloadNotificationTone();

  const audio = createAudioElement();
  if (!audio) return;

  clearActivePlayback();

  audio.volume = clamp(Number(volumePercent) / 100, 0, 1);
  activeAudio = audio;

  try {
    await audio.play();
  } catch {
    if (activeAudio === audio) {
      activeAudio = null;
    }
    return;
  }

  audio.onended = () => {
    if (activeAudio === audio) {
      activeAudio = null;
    }
  };
  audio.onerror = () => {
    if (activeAudio === audio) {
      activeAudio = null;
    }
  };
}

void preloadNotificationTone();


