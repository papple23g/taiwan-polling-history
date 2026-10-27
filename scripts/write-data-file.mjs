import { randomUUID } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

export async function writeDataFile(path, data, encoding = 'utf8') {
  // Replacing a complete sibling file avoids truncation failures in Windows cloud folders.
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, data, { encoding, flag: 'wx' });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporaryPath, path);
        break;
      } catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
        await setTimeout(100 * 2 ** attempt);
      }
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
