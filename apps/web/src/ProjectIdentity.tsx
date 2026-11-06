import { ProjectColorSchema, ProjectIconSchema, type ProjectRoom } from '@jarvis-command/contracts';

export const projectGlyphs = { tiles: '▦', orbit: '◎', peak: '△', spark: '✦' } as const;
export const projectAccents = ['green', 'blue', 'violet', 'amber'] as const;
type Identity = Pick<ProjectRoom, 'id' | 'projectIcon' | 'projectColor'>;
// Stable across rename/reload, independent of list order or JavaScript random state.
export function projectIdentity(project: Identity) {
  let hash = 2166136261;
  for (const character of project.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const icons = Object.keys(projectGlyphs) as (keyof typeof projectGlyphs)[];
  const icon = ProjectIconSchema.safeParse(project.projectIcon);
  const color = ProjectColorSchema.safeParse(project.projectColor);
  return {
    icon: icon.success && icon.data !== 'auto' ? icon.data : icons[hash % icons.length]!,
    color: color.success && color.data !== 'auto' ? color.data : projectAccents[(hash >>> 8) % projectAccents.length]!,
  };
}
// Omit unknown read tokens on unrelated writes: the existing store merge retains them.
export function identityMetadata(project: Pick<ProjectRoom, 'projectIcon' | 'projectColor'>) {
  const icon = ProjectIconSchema.safeParse(project.projectIcon), color = ProjectColorSchema.safeParse(project.projectColor);
  return { ...(icon.success ? { projectIcon: icon.data } : {}), ...(color.success ? { projectColor: color.data } : {}) };
}
export function ProjectIdentity({ project }: Readonly<{ project: Identity }>) {
  const identity = projectIdentity(project);
  return <span className="project-identity" aria-hidden="true" data-icon={identity.icon} data-color={identity.color} data-glyph={projectGlyphs[identity.icon]} />;
}
export function ProjectIdentitySettings({ projectIcon, projectColor, disabled, onChange }: Readonly<{
  projectIcon?: string | undefined; projectColor?: string | undefined; disabled: boolean;
  onChange: (fields: { projectIcon?: string; projectColor?: string }) => void;
}>) {
  return <fieldset className="project-identity-settings" disabled={disabled}><legend>Project identity</legend>
    <p className="muted small">Automatic choices stay with this project when you rename it. Labels always identify projects.</p>
    <label>Project glyph<select name="projectIcon" value={ProjectIconSchema.safeParse(projectIcon).success ? projectIcon : 'auto'} onChange={event => onChange({ projectIcon: event.target.value })}>
      <option value="auto">Automatic glyph</option>{Object.entries(projectGlyphs).map(([key, glyph]) => <option key={key} value={key}>{glyph} {key[0]!.toUpperCase() + key.slice(1)}</option>)}
    </select></label>
    <label>Project accent<select name="projectColor" value={ProjectColorSchema.safeParse(projectColor).success ? projectColor : 'auto'} onChange={event => onChange({ projectColor: event.target.value })}>
      <option value="auto">Automatic accent</option>{projectAccents.map(color => <option key={color} value={color}>{color[0]!.toUpperCase() + color.slice(1)}</option>)}
    </select></label>
  </fieldset>;
}
