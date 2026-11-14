import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageContent } from './MessageContent';

const projectId = 'room_' + 'a'.repeat(32);
const sessionId = 'jc_' + 'b'.repeat(32);

it('renders exact thread tokens as accessible local controls only inside a selected project', () => {
  const onThreadLink = vi.fn();
  render(<MessageContent text={`Open [the research thread](thread:${sessionId}).`} threadProjectId={projectId} threadProjectSessionIds={[sessionId]} onThreadLink={onThreadLink} />);
  const link = screen.getByRole('button', { name: 'the research thread' });
  fireEvent.keyDown(link, { key: 'Enter' });
  fireEvent.click(link);
  expect(onThreadLink).toHaveBeenCalledExactlyOnceWith(projectId, sessionId);

  render(<MessageContent text={`[project thread](thread:${sessionId})`} />);
  expect(screen.queryByRole('button', { name: 'project thread' })).toBeNull();
});

it('keeps code, quoted excerpts, malformed or encoded tokens, user content and tool text inert', () => {
  const onThreadLink = vi.fn();
  const text = [
    'Inline `[code](thread:' + sessionId + ')`.',
    `> [quoted roster text](thread:${sessionId})`,
    `\`\`\`md\n[code fence](thread:${sessionId})\n\`\`\``,
    '[malformed](thread:jc/short)',
    `[encoded](thread:%6Ac_${'b'.repeat(32)})`,
    `[foreign](thread:jc_${'c'.repeat(32)})`,
    '[internal](/api/live/runs)',
    '[external](https://example.com)',
  ].join('\n\n');
  const view = render(<MessageContent text={text} threadProjectId={projectId} threadProjectSessionIds={[sessionId]} onThreadLink={onThreadLink} />);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.getByRole('link', { name: 'external' })).toHaveAttribute('href', 'https://example.com/');
  expect(screen.queryByRole('link', { name: 'internal' })).toBeNull();
  expect(view.container.querySelector('img,script,iframe')).toBeNull();
  expect(onThreadLink).not.toHaveBeenCalled();
});

describe('stored files in messages', () => {
  const id = 'art_' + 'b'.repeat(32);
  it('shows Command images inline and other stored files as download cards', () => {
    render(<MessageContent text={`![graph.png](/api/artifacts/${id}/versions/1/blob)\n\n[backup.zip](/api/artifacts/${id}/versions/2/download)\n\n![remote](https://example.com/x.png) [inert](/api/sessions)`} />);
    expect(screen.getByRole('img', { name: 'graph.png' })).toHaveAttribute('src', `/api/artifacts/${id}/versions/1/blob`);
    const card = screen.getByRole('link', { name: 'backup.zip' });
    expect(card).toHaveAttribute('href', `/api/artifacts/${id}/versions/2/download`);
    expect(card).toHaveAttribute('download');
    expect(screen.getByText('[Image not loaded: remote]')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'inert' })).toBeNull();
  });
});
