// The shell reads the notification inbox on load; unrelated synthetic suites answer it with an empty one.
export const emptyInbox = {
  version: 1, items: [], unreadCount: 0,
  preferences: { categories: { 'run-completed': true, 'run-failed': true, approval: true } },
  delivery: { inApp: 'available', push: 'unavailable', externalSurfaces: 'unavailable' },
};
