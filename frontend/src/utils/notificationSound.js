import notificationToneUrl from '../assets/notify.wav';

let cachedAudio = null;
let currentAudioPath = null;
let unlockHandlersBound = false;
let lastTriggerAtMs = 0;

const DEBOUNCE_MS = 220;
const NOTIFICATION_SOUND_PATH = notificationToneUrl;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const resolveNotificationSoundPath = (soundFile) => {
  const selectedSound = String(soundFile || '').trim();
  if (selectedSound) {
    return `/sounds/notifications/${encodeURIComponent(selectedSound)}`;
  }

  try {
    const storedSound = window.localStorage.getItem('shelfio.toast.sound.file');
    if (storedSound) {
      return `/sounds/notifications/${encodeURIComponent(storedSound)}`;
    }
  } catch {
    // Sessiz fallback.
  }

  return NOTIFICATION_SOUND_PATH;
};

const getOrInitializeAudio = (soundFile) => {
  if (typeof window === 'undefined' || typeof window.Audio === 'undefined') {
    return null;
  }

  const path = resolveNotificationSoundPath(soundFile);

  if (!cachedAudio || currentAudioPath !== path) {
    if (cachedAudio) {
      try {
        cachedAudio.pause();
        cachedAudio.src = '';
        cachedAudio.load();
      } catch {
        // ignore
      }
    }

    cachedAudio = new window.Audio(path);
    cachedAudio.preload = 'auto';
    currentAudioPath = path;
    cachedAudio.addEventListener('error', () => {
      console.warn('Notification audio file could not be loaded:', path);
    });

    // Start preloading immediately
    try {
      cachedAudio.load();
    } catch {
      // ignore
    }
  }

  return cachedAudio;
};

const bindUnlockHandlers = () => {
  if (unlockHandlersBound || typeof window === 'undefined') {
    return;
  }

  unlockHandlersBound = true;

  const unlock = () => {
    const audio = getOrInitializeAudio();
    if (!audio) {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
      return;
    }

    const originalVolume = audio.volume;
    audio.volume = 0;
    audio.play()
      .then(() => {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          // ignore
        }
      })
      .catch(() => {})
      .finally(() => {
        audio.volume = originalVolume;
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('touchstart', unlock);
        window.removeEventListener('keydown', unlock);
      });
  };

  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('touchstart', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true, passive: true });
};

export function preloadNotificationTone(soundFile) {
  bindUnlockHandlers();

  const audio = getOrInitializeAudio(soundFile);
  if (!audio) return Promise.resolve();

  try {
    audio.load();
  } catch {
    // ignore
  }

  return Promise.resolve(audio);
}

export async function playNotificationTone(volumePercent = 40, soundFile) {
  const nowMs = Date.now();
  if (nowMs - lastTriggerAtMs < DEBOUNCE_MS) {
    return;
  }
  lastTriggerAtMs = nowMs;

  bindUnlockHandlers();

  const audio = getOrInitializeAudio(soundFile);
  if (!audio) return;

  try {
    audio.currentTime = 0;
    audio.volume = clamp(Number(volumePercent) / 100, 0, 1);
    await audio.play();
  } catch (error) {
    console.warn('Notification audio playback failed:', error);
  }
}

// Initial preloading on script load
try {
  preloadNotificationTone();
} catch {
  // ignore
}
