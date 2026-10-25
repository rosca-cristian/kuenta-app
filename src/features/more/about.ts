/** What Ajustes tells about the app: the libraries it ships and the space its data uses. */

/** A library Kuenta ships, as listed in Más → Licencias. */
export interface LibraryLicense {
  name: string;
  version: string;
  license: string;
}

/**
 * Every package the app ships, its dependencies' dependencies included, with the version
 * installed and its licence (SPDX), read from the lockfile at build time.
 */
export const LIBRARIES: LibraryLicense[] = __LIBRARIES__;

// Grouping 4-digit thousands too, as amounts do.
const megabytes = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: 'always' });

/** Bytes as shown in Ajustes: megabytes (10⁶ bytes) with one decimal, `2,3 MB`; `—` when unknown. */
export function formatStorageUsage(bytes: number | null): string {
  return bytes === null ? '—' : `${megabytes.format(bytes / 1_000_000)} MB`;
}
