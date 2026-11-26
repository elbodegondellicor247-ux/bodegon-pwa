import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'bodegon_pwa_banner_dismissed_v1';
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let sharedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let sharedIsInstalled = false;
let sharedBannerDismissed = false;
let listenersInitialized = false;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((cb) => cb());
}

function readDismissedState(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts) || Date.now() - ts > DISMISS_TTL_MS) {
      localStorage.removeItem(DISMISS_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function detectPlatform() {
  if (typeof window === 'undefined') {
    return { isStandalone: false, isIOS: false, isIOSSafari: false };
  }
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;

  const ua = window.navigator.userAgent.toLowerCase();
  const isIPadDesktop =
    window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  const isIOS = /iphone|ipad|ipod/.test(ua) || isIPadDesktop;
  const isIOSSafari =
    isIOS && /safari/.test(ua) && !/crios|fxios|edgios|opios/.test(ua);

  return { isStandalone, isIOS, isIOSSafari };
}

function ensureGlobalListeners() {
  if (listenersInitialized || typeof window === 'undefined') return;
  listenersInitialized = true;

  const { isStandalone } = detectPlatform();
  sharedIsInstalled = isStandalone;
  sharedBannerDismissed = readDismissedState();

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    sharedDeferredPrompt = e as BeforeInstallPromptEvent;
    notifySubscribers();
  });

  window.addEventListener('appinstalled', () => {
    sharedIsInstalled = true;
    sharedDeferredPrompt = null;
    notifySubscribers();
  });

  const media = window.matchMedia('(display-mode: standalone)');
  media.addEventListener?.('change', (ev) => {
    if (ev.matches) {
      sharedIsInstalled = true;
      sharedDeferredPrompt = null;
      notifySubscribers();
    }
  });
}

export function usePWAInstall() {
  ensureGlobalListeners();

  const [platform] = useState(detectPlatform);
  const [, setTick] = useState(0);

  useEffect(() => {
    const update = () => setTick((t) => t + 1);
    subscribers.add(update);
    return () => {
      subscribers.delete(update);
    };
  }, []);

  const install = async () => {
    if (!sharedDeferredPrompt) return false;
    await sharedDeferredPrompt.prompt();
    const { outcome } = await sharedDeferredPrompt.userChoice;
    if (outcome === 'accepted') {
      sharedIsInstalled = true;
      sharedDeferredPrompt = null;
      notifySubscribers();
      return true;
    }
    return false;
  };

  const dismissBanner = () => {
    sharedBannerDismissed = true;
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Ignore storage errors
    }
    notifySubscribers();
  };

  return {
    isInstallable: Boolean(sharedDeferredPrompt),
    isInstalled: sharedIsInstalled || platform.isStandalone,
    isIOS: platform.isIOS,
    isIOSSafari: platform.isIOSSafari,
    isBannerDismissed: sharedBannerDismissed,
    install,
    dismissBanner,
  };
}
