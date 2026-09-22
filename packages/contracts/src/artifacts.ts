import { z } from 'zod';
import { SessionIdSchema } from './contracts';
import { ProjectRoomIdSchema } from './project-rooms';

const IsoTimestampSchema = z.iso.datetime({ offset: true });
const SafeTextSchema = (maximum: number) => z.string().max(maximum);
const NonBlankTextSchema = (maximum: number) => z.string().trim().min(1).max(maximum);

export const ArtifactIdSchema = z.string().regex(/^art_[a-f0-9]{32}$/);
export const ArtifactTypeSchema = z.enum([
  'markdown',
  'text',
  'report',
  'log',
  'code',
  'diff',
  'html',
  'svg',
  'mermaid',
  'image',
  'pdf',
  'file',
]);
export const ArtifactMimeSchema = z.string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\+[a-z0-9][a-z0-9!#$&^_.+-]*)?$/i);
export const ArtifactSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const ArtifactSourceRequestIdSchema = z.string().regex(/^gen_[a-f0-9]{32}$/);
export const ArtifactFilenameSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[^/\\\0]+$/)
  .refine((value) => value !== '.' && value !== '..' && !value.startsWith('.'), 'Unsafe filename');
export const ArtifactVersionNumberSchema = z.number().int().min(1).max(10_000);
export const ArtifactCreatorSchema = z.object({
  subject: SafeTextSchema(160),
  source: z.enum(['human', 'assistant-response', 'upload', 'revision', 'export']),
}).strict();

export const ArtifactVersionSchema = z.object({
  version: ArtifactVersionNumberSchema,
  parentVersion: ArtifactVersionNumberSchema.nullable(),
  baseVersion: ArtifactVersionNumberSchema.nullable(),
  createdAt: IsoTimestampSchema,
  creator: ArtifactCreatorSchema,
  type: ArtifactTypeSchema.optional(),
  mime: ArtifactMimeSchema,
  size: z.number().int().nonnegative().max(52_428_800),
  sha256: ArtifactSha256Schema,
  revisionNote: SafeTextSchema(2_000).nullable(),
  feedback: SafeTextSchema(8_000).nullable(),
  originalFilename: ArtifactFilenameSchema.nullable(),
}).strict();

export const ArtifactCommentSchema = z.object({
  id: z.string().regex(/^comment_[a-f0-9]{24}$/),
  artifactId: ArtifactIdSchema,
  version: ArtifactVersionNumberSchema.nullable(),
  body: NonBlankTextSchema(4_000),
  createdAt: IsoTimestampSchema,
  creator: SafeTextSchema(160),
}).strict();

export const ArtifactSummarySchema = z.object({
  id: ArtifactIdSchema,
  title: NonBlankTextSchema(160),
  type: ArtifactTypeSchema,
  mime: ArtifactMimeSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  creator: ArtifactCreatorSchema,
  sessionId: SessionIdSchema.nullable(),
  projectId: ProjectRoomIdSchema.nullable(),
  runId: z.string().min(1).max(160).nullable(),
  sourceRequestId: ArtifactSourceRequestIdSchema.nullable().default(null),
  size: z.number().int().nonnegative().max(52_428_800),
  sha256: ArtifactSha256Schema,
  currentVersion: ArtifactVersionNumberSchema,
  canonical: z.boolean(),
  privateMode: z.enum(['private']),
  originalFilename: ArtifactFilenameSchema.nullable(),
}).strict();

export const ArtifactMetadataSchema = ArtifactSummarySchema.extend({
  versions: z.array(ArtifactVersionSchema).min(1).max(10_000),
  comments: z.array(ArtifactCommentSchema).max(1_000),
}).strict();

export const ArtifactListQuerySchema = z.object({
  sessionId: SessionIdSchema.optional(),
  projectId: ProjectRoomIdSchema.optional(),
  type: ArtifactTypeSchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).default(50),
}).strict();

export const ArtifactListResponseSchema = z.object({
  artifacts: z.array(ArtifactSummarySchema).max(100),
}).strict();

export const ArtifactCreateTextRequestSchema = z.object({
  title: NonBlankTextSchema(160),
  type: ArtifactTypeSchema.exclude(['image', 'pdf', 'file']),
  mime: ArtifactMimeSchema.optional(),
  content: NonBlankTextSchema(1_048_576),
  sessionId: SessionIdSchema.nullable().optional(),
  projectId: ProjectRoomIdSchema.nullable().optional(),
  runId: z.string().min(1).max(160).nullable().optional(),
  sourceRequestId: ArtifactSourceRequestIdSchema.nullable().optional(),
  source: ArtifactCreatorSchema.shape.source.default('human'),
  canonical: z.boolean().default(false),
  revisionNote: SafeTextSchema(2_000).nullable().optional(),
  feedback: SafeTextSchema(8_000).nullable().optional(),
}).strict();

export const ArtifactCreateVersionRequestSchema = z.object({
  baseVersion: ArtifactVersionNumberSchema,
  type: ArtifactTypeSchema.exclude(['image', 'pdf', 'file']).optional(),
  mime: ArtifactMimeSchema.optional(),
  content: NonBlankTextSchema(1_048_576),
  revisionNote: SafeTextSchema(2_000).nullable().optional(),
  feedback: SafeTextSchema(8_000).nullable().optional(),
}).strict();

export const ArtifactCanonicalRequestSchema = z.object({
  canonical: z.boolean(),
  currentVersion: ArtifactVersionNumberSchema,
}).strict();

export const ArtifactDeleteRequestSchema = z.object({
  confirmArtifactId: ArtifactIdSchema,
  currentVersion: ArtifactVersionNumberSchema,
}).strict();

export const ArtifactCommentCreateRequestSchema = z.object({
  version: ArtifactVersionNumberSchema.nullable().optional(),
  body: NonBlankTextSchema(4_000),
}).strict();

export const ArtifactSourceResponseSchema = z.object({
  artifactId: ArtifactIdSchema,
  version: ArtifactVersionNumberSchema,
  type: ArtifactTypeSchema,
  mime: ArtifactMimeSchema,
  size: z.number().int().nonnegative().max(1_048_576),
  sha256: ArtifactSha256Schema,
  content: SafeTextSchema(1_048_576),
}).strict();

export const ArtifactCompareQuerySchema = z.object({
  from: z.string().regex(/^\d+$/).transform(Number).pipe(ArtifactVersionNumberSchema),
  to: z.string().regex(/^\d+$/).transform(Number).pipe(ArtifactVersionNumberSchema),
}).strict();

export const ArtifactCompareResponseSchema = z.object({
  artifactId: ArtifactIdSchema,
  from: ArtifactVersionNumberSchema,
  fromType: ArtifactTypeSchema,
  to: ArtifactVersionNumberSchema,
  toType: ArtifactTypeSchema,
  diff: SafeTextSchema(262_144),
}).strict();

export const ArtifactMutationResponseSchema = z.object({
  artifact: ArtifactMetadataSchema,
}).strict();

export const ArtifactDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  artifactId: ArtifactIdSchema,
}).strict();

export type ArtifactComment = z.infer<typeof ArtifactCommentSchema>;
export type ArtifactCreateTextRequest = z.infer<typeof ArtifactCreateTextRequestSchema>;
export type ArtifactCreateVersionRequest = z.infer<typeof ArtifactCreateVersionRequestSchema>;
export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;
