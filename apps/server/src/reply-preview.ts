export const REPLY_PREVIEW_LIMIT = 120;
export const GENERIC_REPLY_BODY = 'Jarvis sent a reply. Open the chat to read it.';

/**
 * One bounded plain-text line from assistant markdown: no control/bidi characters, markup, URLs'
 * link syntax or newlines. Returns null when nothing readable remains (so no push is sent).
 */
export function replyPreview(text: string, limit = REPLY_PREVIEW_LIMIT): string | null {
  const plain = text
    .replace(/```[^\n]*\n?([\s\S]*?)(```|$)/g, ' $1 ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\s][^>]*>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d{1,3}[.)]\s+)/gm, '')
    .replace(/[`*_~|]+/g, '')
    // eslint-disable-next-line no-control-regex, no-irregular-whitespace
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  const characters = Array.from(plain);
  return characters.length <= limit ? plain : `${characters.slice(0, limit - 1).join('').trimEnd()}…`;
}

/** Executed model label only; sanitized like the preview and never a requested route. */
export function executedLabel(model: string | null | undefined): string | null {
  const label = replyPreview(model ?? '', 60);
  return label;
}
