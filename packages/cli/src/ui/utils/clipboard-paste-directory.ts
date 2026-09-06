/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { registerCleanup } from '../../utils/cleanup.js';

const directories = new Map<string, Promise<string>>();

export function getClipboardPasteDirectory(
  runtimeDir: string,
): Promise<string> {
  const root = path.resolve(runtimeDir, 'clipboard');
  const existing = directories.get(root);
  if (existing) return existing;
  const pending = createDirectory(root);
  directories.set(root, pending);
  void pending.catch(() => {
    if (directories.get(root) === pending) directories.delete(root);
  });
  return pending;
}

async function createDirectory(root: string): Promise<string> {
  await fs.mkdir(root, { recursive: true });
  // Only reap directories whose owning process is gone. Active attachments may
  // be queued for a later turn, even after their composer has been cleared.
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const owner = /^paste-(\d+)-[a-zA-Z0-9]{6}$/.exec(entry.name);
    if (!owner || !entry.isDirectory()) continue;
    try {
      process.kill(Number(owner[1]), 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        await fs
          .rm(path.join(root, entry.name), { recursive: true, force: true })
          .catch(() => {});
      }
    }
  }
  const directory = await fs.mkdtemp(path.join(root, `paste-${process.pid}-`));
  registerCleanup(async () => {
    directories.delete(root);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}
