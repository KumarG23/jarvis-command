export class NotificationStorageError extends Error {
  readonly statusCode = 503;
  constructor(readonly reason: string = 'unspecified') { super('Notification storage unavailable'); this.name = 'NotificationStorageError'; }
}
export class NotificationNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() { super('Notification not found'); }
}

