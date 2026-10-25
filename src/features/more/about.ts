/** What Ajustes tells about the app: the libraries it ships and the space its data uses. */

/** A library Kuenta ships, as listed in Más → Licencias. */
export interface LibraryLicense {
  name: string;
  version: string;
  license: string;
}

/**
 * Every runtime dependency in `package.json`, with the version installed and its licence (SPDX)
 * from the library's own `package.json`. A test fails when it and `dependencies` differ.
 */
export const LIBRARIES: LibraryLicense[] = [
  { name: '@radix-ui/react-dialog', version: '1.3.1', license: 'MIT' },
  { name: 'dexie', version: '4.4.6', license: 'Apache-2.0' },
  { name: 'lucide-react', version: '1.60.0', license: 'ISC' },
  { name: 'react', version: '19.3.1', license: 'MIT' },
  { name: 'react-dom', version: '19.3.1', license: 'MIT' },
  { name: 'react-is', version: '19.3.1', license: 'MIT' },
  { name: 'react-router-dom', version: '7.18.4', license: 'MIT' },
  { name: 'read-excel-file', version: '9.3.12', license: 'MIT' },
  { name: 'recharts', version: '3.10.1', license: 'MIT' },
  { name: 'vaul', version: '1.1.2', license: 'MIT' },
  { name: 'workbox-precaching', version: '7.4.1', license: 'MIT' },
  { name: 'workbox-routing', version: '7.4.1', license: 'MIT' },
  { name: 'workbox-window', version: '7.4.1', license: 'MIT' },
  { name: 'zod', version: '4.6.7', license: 'MIT' },
];

// Grouping 4-digit thousands too, as amounts do.
const megabytes = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: 'always' });

/** Bytes as shown in Ajustes: megabytes (10⁶ bytes) with one decimal, `2,3 MB`; `—` when unknown. */
export function formatStorageUsage(bytes: number | null): string {
  return bytes === null ? '—' : `${megabytes.format(bytes / 1_000_000)} MB`;
}
