import { describe, it, expect } from 'vitest';
import fs from 'fs';

// src/resolvers/index.js require()s EVERY entry in that directory at boot (except
// index.js itself) and reads `.default` from it. Two things take the whole BFF down —
// which the browser then reports as CORS errors:
//   - a folder without an index.js default export (e.g. a helpers folder);
//   - any loose file next to index.js (a test file, say) — it gets require()d too.
describe('src/resolvers layout', () => {
  const entries = fs.readdirSync('./src/resolvers', { withFileTypes: true });

  it('has no loose files besides index.js', () => {
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    expect(files).toEqual(['index.js']);
  });

  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  it.each(folders)('%s exports a resolver map as default', async (folder) => {
    const mod = await import(`../resolvers/${folder}/index.js`);
    expect(typeof mod.default).toBe('object');
    expect(mod.default).not.toBeNull();
  });
});
