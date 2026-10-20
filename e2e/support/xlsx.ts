import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { SampleFileOptions, SampleMovement } from '../../test/support/bbvaXlsx';

const script = fileURLToPath(new URL('./make-xlsx.ts', import.meta.url));

/**
 * Builds a synthetic BBVA file in a separate Node process: exceljs doesn't load
 * inside Playwright's test loader.
 */
export function bbvaXlsxFile(movements: SampleMovement[], options?: SampleFileOptions) {
  const base64 = execFileSync(process.execPath, [script], { input: JSON.stringify({ movements, options }) }).toString();
  return {
    name: 'movimientos.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(base64, 'base64'),
  };
}
