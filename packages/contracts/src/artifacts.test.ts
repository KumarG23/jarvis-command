import { describe, expect, it } from 'vitest';

import {
  ArtifactCreateTextRequestSchema,
  ArtifactCreateVersionRequestSchema,
} from './artifacts';

const createBase = { title: 'Notes', type: 'text' as const, source: 'human' as const };

describe('artifact text content contracts', () => {
  it('preserves leading indentation, trailing newlines and Unicode on create while still normalizing the title', () => {
    const content = '  indented code\n\n';
    const parsed = ArtifactCreateTextRequestSchema.parse({ ...createBase, title: '  Notes  ', content });

    expect(parsed.content).toBe(content);
    expect(new TextEncoder().encode(parsed.content)).toHaveLength(17);
    expect(parsed.title).toBe('Notes');

    const unicode = '  café ☃\n';
    expect(ArtifactCreateTextRequestSchema.parse({ ...createBase, content: unicode }).content).toBe(unicode);
  });

  it('preserves leading indentation and trailing newlines on revision', () => {
    const content = '\n    nested code\n\n';
    const parsed = ArtifactCreateVersionRequestSchema.parse({ baseVersion: 1, content });

    expect(parsed.content).toBe(content);
  });

  it('rejects blank-only content on create and revision and keeps the existing maximum', () => {
    for (const content of ['', '   ', '\n\t\n']) {
      expect(() => ArtifactCreateTextRequestSchema.parse({ ...createBase, content })).toThrow();
      expect(() => ArtifactCreateVersionRequestSchema.parse({ baseVersion: 1, content })).toThrow();
    }

    const maximum = 'x'.repeat(1_048_576);
    expect(ArtifactCreateTextRequestSchema.parse({ ...createBase, content: maximum }).content).toBe(maximum);
    expect(ArtifactCreateVersionRequestSchema.parse({ baseVersion: 1, content: maximum }).content).toBe(maximum);
    expect(() => ArtifactCreateTextRequestSchema.parse({ ...createBase, content: `${maximum}x` })).toThrow();
    expect(() => ArtifactCreateVersionRequestSchema.parse({ baseVersion: 1, content: `${maximum}x` })).toThrow();
  });
});
