import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileDown } from 'lucide-react';
import { SessionIdSchema } from '@jarvis-command/contracts';

// Files stored in Command (uploads, or files Jarvis sent) are the only same-origin URLs a message may use.
const ARTIFACT_FILE = /^\/api\/artifacts\/art_[a-f0-9]{32}\/versions\/[1-9]\d{0,4}\/(blob|download)$/;
const artifactFile = (url: string | undefined) => (url ? ARTIFACT_FILE.exec(url)?.[1] ?? null : null) as 'blob' | 'download' | null;

type MarkdownNode = { type?: string; url?: string; children?: MarkdownNode[] };

function threadSessionId(url: string | undefined): string | null {
  if (!url?.startsWith('thread:')) return null;
  const candidate = url.slice('thread:'.length);
  return SessionIdSchema.safeParse(candidate).success && !candidate.includes('%') ? candidate : null;
}

// Quoted assistant excerpts are data. Keep a thread token inside a Markdown
// blockquote readable but inert, like the labelled roster data in lead context.
function inertQuotedThreadLinks() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode, quoted: boolean) => {
      const inQuote = quoted || node.type === 'blockquote';
      if (inQuote && node.type === 'link' && threadSessionId(node.url)) node.url = '';
      node.children?.forEach(child => visit(child, inQuote));
    };
    visit(tree, false);
  };
}

// No raw HTML plugins and no automatic remote loads (including Markdown images).
// Links are explicit external HTTP(S) navigations; app-origin actions stay inert, except
// Command's own stored files: images show inline and other files get a download card.
export function MessageContent({ text, className = '', threadProjectId, threadProjectSessionIds, onThreadLink }: Readonly<{ text: string; className?: string; threadProjectId?: string | null | undefined; threadProjectSessionIds?: readonly string[] | undefined; onThreadLink?: ((projectId: string, sessionId: string) => void) | undefined }>) {
  return <div className={`message-content ${className}`}><ReactMarkdown remarkPlugins={[remarkGfm, inertQuotedThreadLinks]} skipHtml
    urlTransform={url => {
      if (threadSessionId(url) || artifactFile(url)) return url;
      try {
        const parsed = new URL(url);
        return ['https:', 'http:'].includes(parsed.protocol) && parsed.origin !== window.location.origin && !parsed.username && !parsed.password ? parsed.href : '';
      } catch { return ''; }
    }}
    components={{
      a: ({ href, children }) => {
        const sessionId = threadSessionId(href);
        if (sessionId) return threadProjectId && onThreadLink && threadProjectSessionIds?.includes(sessionId)
          ? <button className="message-thread-link" type="button" onClick={() => onThreadLink(threadProjectId, sessionId)}>{children}</button>
          : <span>{children}</span>;
        if (artifactFile(href)) return <a className="message-file" href={href} download><FileDown size={16} aria-hidden="true" /><span>{children}</span></a>;
        return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
      },
      img: ({ src, alt }) => typeof src === 'string' && artifactFile(src) === 'blob'
        ? <a className="message-inline-image" href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={alt ?? ''} loading="lazy" /></a>
        : <span className="message-image-placeholder">[Image not loaded{alt ? `: ${alt}` : ''}]</span>,
      table: ({ children }) => <div className="message-table" role="region" aria-label="Message table" tabIndex={0}><table>{children}</table></div>,
      pre: ({ children }) => <pre tabIndex={0} aria-label="Code block">{children}</pre>,
    }}>{text}</ReactMarkdown></div>;
}
