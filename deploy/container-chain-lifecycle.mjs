/* global setTimeout, clearTimeout */
export async function boundedStage(stage, action, milliseconds = 2000) {
  let timer;
  try {
    const value = await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(stage + ' deadline exceeded')), milliseconds); })]);
    return { stage, ok: true, value };
  } catch (error) { return { stage, ok: false, error: String(error.stack ?? error) }; }
  finally { clearTimeout(timer); }
}

export async function finalizeBrowser({ diagnostic, contextClose, browserClose, record, milliseconds = 2000 }) {
  // Recording itself must not stop subsequent close attempts.
  try { record(await boundedStage('diagnostic', diagnostic, milliseconds)); }
  finally {
    try { record(await boundedStage('context-close', contextClose, milliseconds)); }
    finally { record(await boundedStage('browser-close', browserClose, milliseconds)); }
  }
}
