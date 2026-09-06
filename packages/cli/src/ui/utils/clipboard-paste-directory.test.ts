/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getClipboardPasteDirectory } from './clipboard-paste-directory.js';
import { cleanupOldClipboardImages } from './clipboardUtils.js';
import { runExitCleanup } from '../../utils/cleanup.js';

describe('clipboard paste ownership', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'clipboard-ownership-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await runExitCleanup();
    await fs.rm(root, { recursive: true, force: true });
  });
  it.each([[101], [60, 60]])(
    'keeps accepted files through shared cleanup: %j',
    async (...counts: number[]) => {
      const directory = await getClipboardPasteDirectory(root);
      const paths: string[] = [];
      for (const count of counts) {
        for (let i = 0; i < count; i++) {
          const file = path.join(directory, `clipboard-${paths.length}.png`);
          await fs.writeFile(file, 'image fixture');
          paths.push(file);
        }
        await cleanupOldClipboardImages(root);
        for (const file of paths)
          expect(await fs.readFile(file, 'utf8')).toBe('image fixture');
      }
      await runExitCleanup();
      await expect(fs.stat(directory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );
  it('shares initialization for simultaneous pastes and isolates different runtimes', async () => {
    const [one, two, other] = await Promise.all([
      getClipboardPasteDirectory(root),
      getClipboardPasteDirectory(root),
      getClipboardPasteDirectory(path.join(root, 'other')),
    ]);
    expect(one).toBe(two);
    expect(other).not.toBe(one);
  });
  it('reaps only recognized directories whose owner is gone', async () => {
    const clipboard = path.join(root, 'clipboard');
    await fs.mkdir(clipboard);
    const dead = path.join(clipboard, 'paste-11111-abcdef');
    const live = path.join(clipboard, 'paste-22222-abcdef');
    const denied = path.join(clipboard, 'paste-33333-abcdef');
    const unknown = path.join(clipboard, 'unrelated');
    for (const dir of [dead, live, denied, unknown]) await fs.mkdir(dir);
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 11111)
        throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      if (pid === 33333)
        throw Object.assign(new Error('denied'), { code: 'EPERM' });
      return true;
    });
    await getClipboardPasteDirectory(root);
    await expect(fs.stat(dead)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const dir of [live, denied, unknown])
      expect((await fs.stat(dir)).isDirectory()).toBe(true);
    expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
  });
});
