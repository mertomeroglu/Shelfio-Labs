export const CAMERA_PERMISSION_HELP_TEXT = 'Kamera çalışmazsa barkodu manuel olarak girebilirsiniz.';

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

const stopMediaStream = (stream) => {
  if (!stream?.getTracks) return;
  stream.getTracks().forEach((track) => track.stop());
};

const isLocalhost = () => {
  if (typeof window === 'undefined') return false;
  return LOCALHOST_NAMES.has(window.location?.hostname || '');
};

const isPermissionBlockError = (error) => {
  const name = String(error?.name || '');
  return name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
};

const getDeviceLabelScore = (device) => {
  const label = String(device?.label || '').toLocaleLowerCase('tr-TR');
  if (!label) return 0;
  if (/(back|rear|environment|arka|sirt|sırt)/i.test(label)) return 2;
  return 1;
};

export function getCameraDebugSnapshot(error = null) {
  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
  return {
    name: String(error?.name || ''),
    message: String(error?.message || ''),
    constraint: String(error?.constraint || error?.constraintName || ''),
    href: typeof window !== 'undefined' ? window.location.href : '',
    isSecureContext: typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false,
    hasMediaDevices: Boolean(mediaDevices),
    hasGetUserMedia: Boolean(mediaDevices?.getUserMedia),
  };
}

export function logCameraError(error, context = 'camera') {
  const details = getCameraDebugSnapshot(error);
  console.error(`[camera:${context}] start failed`, details);
  return details;
}

export function formatCameraDebugLines(debug = getCameraDebugSnapshot()) {
  return [
    `Secure context: ${debug.isSecureContext ? 'true' : 'false'}`,
    `mediaDevices: ${debug.hasMediaDevices ? 'true' : 'false'}`,
    `getUserMedia: ${debug.hasGetUserMedia ? 'true' : 'false'}`,
    `Son hata adı: ${debug.name || '-'}`,
    `Son hata mesajı: ${debug.message || '-'}`,
    debug.constraint ? `Constraint: ${debug.constraint}` : '',
    `URL: ${debug.href || '-'}`,
  ].filter(Boolean);
}

export function getCameraPreflightError() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'Kamera erişimi bu ortamda kullanılamıyor.';
  }

  if (!window.isSecureContext) {
    return isLocalhost()
      ? ''
      : 'Kamera için HTTPS bağlantısı gereklidir. Bu adres güvenli context değil.';
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Bu tarayıcı kamera erişimini desteklemiyor.';
  }

  return '';
}

export function getCameraErrorMessage(error) {
  const name = String(error?.name || '').trim();
  const message = String(error?.message || '').toLowerCase();

  if (name === 'CameraPreflightError') {
    return String(error?.message || getCameraPreflightError());
  }

  if (name === 'CameraContainerNotFoundError') {
    return 'Kamera alanı henüz hazır değil. Tekrar deneyin.';
  }

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || message.includes('permission')) {
    return 'Kamera izni reddedildi. Tarayıcı adres çubuğundan kamera iznini açın.';
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Kamera bulunamadı.';
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Kamera başka bir uygulama tarafından kullanılıyor olabilir.';
  }

  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'Seçilen kamera ayarı desteklenmiyor.';
  }

  if (name === 'SecurityError') {
    return 'Kamera güvenlik politikası nedeniyle engellendi.';
  }

  return message
    ? `Kamera başlatılamadı: ${error.message}`
    : 'Kamera başlatılamadı. Detay için kamera debug bilgisini kontrol edin.';
}

export async function waitForCameraElement(elementId, timeoutMs = 1200) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const element = document.getElementById(elementId);
    if (element) return element;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  const error = new Error(`Camera container not found: #${elementId}`);
  error.name = 'CameraContainerNotFoundError';
  error.constraint = elementId;
  throw error;
}

export async function prepareCameraAccess() {
  const preflightError = getCameraPreflightError();
  if (preflightError) {
    const error = new Error(preflightError);
    error.name = 'CameraPreflightError';
    throw error;
  }

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } finally {
    stopMediaStream(stream);
  }

  let videoDevices = [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices = devices.filter((device) => device.kind === 'videoinput');
  } catch {
    videoDevices = [];
  }

  return { devices: videoDevices };
}

export async function startHtml5Scanner(scanner, scannerConfig, onScanSuccess, onScanFailure = () => {}) {
  const access = await prepareCameraAccess();
  const sortedDevices = [...access.devices].sort((a, b) => getDeviceLabelScore(b) - getDeviceLabelScore(a));
  const primaryCamera = sortedDevices[0]?.deviceId || { facingMode: { ideal: 'environment' } };
  const fallbackCamera = sortedDevices.find((device) => device.deviceId !== sortedDevices[0]?.deviceId)?.deviceId
    || { facingMode: 'user' };

  try {
    await scanner.start(primaryCamera, scannerConfig, onScanSuccess, onScanFailure);
  } catch (error) {
    if (isPermissionBlockError(error)) {
      throw error;
    }
    await scanner.start(fallbackCamera, scannerConfig, onScanSuccess, onScanFailure);
  }
  return access.devices;
}
