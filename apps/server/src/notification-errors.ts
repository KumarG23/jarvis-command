export class NotificationStorageError extends Error {
  readonly statusCode = 503;
  constructor() { super('Notification storage unavailable'); }
}
export class NotificationNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() { super('Notification not found'); }
}

