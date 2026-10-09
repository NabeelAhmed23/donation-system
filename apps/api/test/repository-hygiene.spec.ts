import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
// Built from parts so this file does not match itself.
const PLACEHOLDER = ['See the change', 'entry for'].join(' ');

describe('repository hygiene', () => {
  it('has no placeholder text committed in place of source or test files', () => {
    const files = ['src', 'test'].flatMap((dir) =>
      readdirSync(join(apiRoot, dir), { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.ts'))
        .map((file) => join(dir, file)),
    );

    const placeholders = files.filter((file) => readFileSync(join(apiRoot, file), 'utf8').includes(PLACEHOLDER));

    expect(files.length).toBeGreaterThan(0);
    expect(placeholders).toEqual([]);
  });
});
