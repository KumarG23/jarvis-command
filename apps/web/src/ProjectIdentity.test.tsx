import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { identityMetadata, ProjectIdentity, projectIdentity } from './ProjectIdentity';

const project = { id: 'room_' + 'b'.repeat(32), name: 'Synthetic original' };
it('keeps deterministic independent defaults after rename/reload and falls back for unknown tokens', () => {
  const identity = projectIdentity(project);
  expect(projectIdentity(JSON.parse(JSON.stringify({ ...project, name: 'Renamed' })))).toEqual(identity);
  expect(projectIdentity({ ...project, projectIcon: 'unknown', projectColor: 'unknown' })).toEqual(identity);
  expect(projectIdentity({ ...project, projectIcon: 'auto', projectColor: 'auto' })).toEqual(identity);
  expect(new Set(Array.from({ length: 16 }, (_, i) => JSON.stringify(projectIdentity({ id: `room_${i.toString(16).padStart(32, '0')}` })))).size).toBeGreaterThan(4);
  expect(projectIdentity({ ...project, projectIcon: 'orbit', projectColor: 'violet' })).toEqual({ icon: 'orbit', color: 'violet' });
  const { container } = render(<ProjectIdentity project={{ ...project, projectIcon: 'orbit', projectColor: 'violet' }} />);
  expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  expect(container.firstChild).toHaveAttribute('data-icon', 'orbit');
  expect(container.firstChild).toBeEmptyDOMElement();
  expect(identityMetadata({ projectIcon: 'future', projectColor: 'blue' })).toEqual({ projectColor: 'blue' });
});
function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}
it('measures AA text contrast for project accents and existing status tokens on rendered dark surfaces', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  const token = (name: string) => css.match(new RegExp(`--${name}: (#[a-f0-9]{6})`))![1]!;
  for (const color of ['project-green', 'project-blue', 'project-violet', 'project-amber', 'text', 'muted', 'subtle', 'green', 'amber', 'red']) {
    for (const surface of ['bg', 'sidebar', 'panel', 'surface']) {
      const ratio = (luminance(token(color)) + .05) / (luminance(token(surface)) + .05);
      expect(ratio, `${color} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
