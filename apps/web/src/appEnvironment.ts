// Preview shares live APIs, but must never share this tab's recovery/view state.
export function previewPath(base = import.meta.env.BASE_URL, pathname = window.location.pathname): string | null {
  const pattern = /^(\/api\/preview\/[a-z0-9][a-z0-9-]*\/)/;
  return base.match(pattern)?.[1] ?? pathname.match(pattern)?.[1] ?? null;
}

export function appStorageKey(key: string): string {
  const preview = previewPath();
  return preview ? `${key}:preview:${preview}` : key;
}

export async function recoverSignIn(
  location: Pick<Location, 'origin' | 'pathname' | 'replace'> = window.location,
  serviceWorker: Pick<ServiceWorkerContainer, 'getRegistration'> | undefined = navigator.serviceWorker,
  base = import.meta.env.BASE_URL,
) {
  const preview = previewPath(base, location.pathname);
  if (preview) {
    // A clean top-level Access navigation. No root worker or root recovery URL.
    location.replace(preview);
    return;
  }
  if (location.pathname !== '/' && location.pathname !== '/index.html') throw new Error('recovery_unavailable');
  const registration = await serviceWorker?.getRegistration('/');
  if (registration) {
    const ownScript = `${location.origin}/sw.js`;
    const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
    if (registration.scope !== `${location.origin}/` || workers.some(worker => worker!.scriptURL !== ownScript)) throw new Error('recovery_unavailable');
    if (!await registration.unregister()) throw new Error('recovery_unavailable');
  }
  location.replace('/api/auth/recover');
}
