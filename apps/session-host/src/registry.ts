import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CockpitSessionSchema, type CockpitSession } from '@jarvis-command/contracts';

const RegistryFileSchema = z.object({ version: z.literal(1), sessions: z.array(CockpitSessionSchema) }).strict();

// Durable record of every cockpit session on this host. tmux owns the processes;
// this file owns identity (project, thread, request id, worktree, native session id).
export class Registry {
  private readonly path: string;
  private sessions = new Map<string, CockpitSession>();

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.path = join(stateDir, 'sessions.json');
    if (existsSync(this.path)) {
      const parsed = RegistryFileSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
      for (const session of parsed.sessions) this.sessions.set(session.id, session);
    }
  }

  all() { return [...this.sessions.values()]; }

  get(id: string) { return this.sessions.get(id); }

  findByRequest(projectId: string, requestId: string) {
    return this.all().find(session => session.projectId === projectId && session.requestId === requestId);
  }

  put(session: CockpitSession) {
    const valid = CockpitSessionSchema.parse(session);
    this.sessions.set(valid.id, valid);
    this.flush();
    return valid;
  }

  remove(id: string) {
    if (this.sessions.delete(id)) this.flush();
  }

  private flush() {
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ version: 1, sessions: this.all() }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
