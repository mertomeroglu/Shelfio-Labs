let modalOpenCount = 0;
let previousBodyOverflow = '';
let keydownAttached = false;
let portalHostRoot = null;
let portalSequence = 0;
const closeStack = [];

const handleGlobalKeyDown = (event) => {
  if (event.key !== 'Escape') return;
  const closeTop = closeStack[closeStack.length - 1];
  if (typeof closeTop === 'function') {
    closeTop();
  }
};

const attachKeydown = () => {
  if (keydownAttached || typeof window === 'undefined') return;
  window.addEventListener('keydown', handleGlobalKeyDown);
  keydownAttached = true;
};

const detachKeydown = () => {
  if (!keydownAttached || typeof window === 'undefined') return;
  window.removeEventListener('keydown', handleGlobalKeyDown);
  keydownAttached = false;
};

const ensurePortalHostRoot = () => {
  if (typeof document === 'undefined') return null;
  if (portalHostRoot && document.body.contains(portalHostRoot)) {
    return portalHostRoot;
  }

  portalHostRoot = document.getElementById('app-modal-portal-root');
  if (!portalHostRoot) {
    portalHostRoot = document.createElement('div');
    portalHostRoot.id = 'app-modal-portal-root';
    portalHostRoot.setAttribute('data-shelfio-modal-root', 'true');
    document.body.appendChild(portalHostRoot);
  }

  return portalHostRoot;
};

export const registerModalLayer = (onClose) => {
  if (typeof document === 'undefined') {
    return () => {};
  }

  if (modalOpenCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  modalOpenCount += 1;

  if (typeof onClose === 'function') {
    closeStack.push(onClose);
  }
  attachKeydown();

  let cleaned = false;

  return () => {
    if (cleaned) return;
    cleaned = true;

    if (typeof onClose === 'function') {
      const index = closeStack.lastIndexOf(onClose);
      if (index >= 0) {
        closeStack.splice(index, 1);
      }
    }

    modalOpenCount = Math.max(0, modalOpenCount - 1);

    if (modalOpenCount === 0) {
      document.body.style.overflow = previousBodyOverflow;
      previousBodyOverflow = '';
      detachKeydown();
    }
  };
};

export const createModalPortalHost = (name = 'modal') => {
  const root = ensurePortalHostRoot();
  if (!root) {
    return { node: null, dispose: () => {} };
  }

  const node = document.createElement('div');
  node.setAttribute('data-shelfio-modal-host', `${name}-${++portalSequence}`);
  root.appendChild(node);

  return {
    node,
    dispose: () => {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }

      if (portalHostRoot && !portalHostRoot.childNodes.length && portalHostRoot.parentNode) {
        portalHostRoot.parentNode.removeChild(portalHostRoot);
        portalHostRoot = null;
      }
    },
  };
};
