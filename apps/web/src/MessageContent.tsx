import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// No raw HTML plugins and no automatic remote loads (including Markdown images).
// Links are explicit external HTTP(S) navigations; app-origin actions stay inert.
export function MessageContent({ text, className = '' }: Readonly<{ text: string; className?: string }>) {
  return <div className={`message-content ${className}`}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={url => {
      try {
        const parsed = new URL(url);
        return ['https:', 'http:'].includes(parsed.protocol) && parsed.origin !== window.location.origin && !parsed.username && !parsed.password ? parsed.href : '';
      } catch { return ''; }
    }}
    components={{
      a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      img: ({ alt }) => <span className="message-image-placeholder">[Image not loaded{alt ? `: ${alt}` : ''}]</span>,
      table: ({ children }) => <div className="message-table" role="region" aria-label="Message table" tabIndex={0}><table>{children}</table></div>,
      pre: ({ children }) => <pre tabIndex={0} aria-label="Code block">{children}</pre>,
    }}>{text}</ReactMarkdown></div>;
}
