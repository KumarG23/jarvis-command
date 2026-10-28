import { z } from 'zod';

export const PushDeviceIdSchema = z.string().regex(/^dev_[a-f0-9]{32}$/);
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().min(1).max(2048),
  expirationTime: z.number().int().positive().max(8_640_000_000_000_000).nullable(),
  keys: z.object({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }).strict(),
}).strict();
export const PushCapabilitySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('available'), publicKey: z.string().regex(/^B[A-Za-z0-9_-]{86}$/) }).strict(),
  z.object({ state: z.literal('unavailable'), reason: z.enum(['disabled', 'configuration', 'storage', 'capacity']) }).strict(),
]);
export const PushDeviceSchema = z.object({
  id: PushDeviceIdSchema,
  registeredAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
}).strict();
export const PushStateSchema = z.object({
  capability: PushCapabilitySchema,
  devices: z.array(PushDeviceSchema).max(8),
}).strict();
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;
export type PushCapability = z.infer<typeof PushCapabilitySchema>;
export type PushState = z.infer<typeof PushStateSchema>;
