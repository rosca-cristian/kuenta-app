import { describe, expect, it } from 'vitest';
import { createDexieRepository } from '../src/data/dexie/dexieRepository';
import { KuentaDb } from '../src/data/dexie/db';
import { backupJson } from '../src/domain/backup';
import { importFile, richData } from './support/backupData';

let dbCount = 0;

/** An onboarded repository on its own database, whose clock reads 20 October 2026 and can move on. */
async function setup() {
  const name = `kuenta-privacy-test-${++dbCount}`;
  const clock = { now: new Date('2026-10-20T10:00:00') };
  const repo = createDexieRepository({ name, now: () => clock.now, appVersion: '1.2.3' });
  await repo.completeOnboarding({ importAccountName: 'BBVA' });
  return { name, repo, clock, db: new KuentaDb(name) };
}

describe('privacy mode', () => {
  it('is off by default, and stays as set after the app reopens', async () => {
    const { name, repo } = await setup();
    expect((await repo.getSettings()).privacyMode).toBe(false);

    await repo.setPrivacyMode(true);
    expect((await repo.getSettings()).privacyMode).toBe(true);
    const reopened = createDexieRepository({ name });
    expect((await reopened.getSettings()).privacyMode).toBe(true);

    await repo.setPrivacyMode(false);
    expect((await reopened.getSettings()).privacyMode).toBe(false);
  });

  it('tells the screens, without counting as a change to the data', async () => {
    const { repo, clock, db } = await setup();
    await importFile(repo, [{ valor: '02/10/2026', concepto: 'Mercadona', movimiento: 'Pago con tarjeta', importe: -50 }], 1000);
    await repo.markBackupMade();
    const lastChangeAt = (await db.settings.get('lastChangeAt'))!.value;
    clock.now = new Date('2026-10-28T10:00:00');

    let notified = 0;
    repo.subscribe(() => notified++);
    await repo.setPrivacyMode(true);
    await repo.setPrivacyMode(false);
    expect(notified).toBe(2);
    expect((await db.settings.get('lastChangeAt'))!.value).toBe(lastChangeAt);
    expect((await repo.home('2026-10')).backupDue).toBe(false);
  });

  it("isn't in a backup, and a restore keeps this phone's", async () => {
    const source = await setup();
    await richData(source.repo);
    await source.repo.setPrivacyMode(true);
    const backup = await source.repo.exportBackup();
    expect(backup.data.settings.map((setting) => setting.key)).not.toContain('privacyMode');
    expect(backupJson(backup)).not.toContain('privacyMode');

    const target = await setup();
    await target.repo.setPrivacyMode(true);
    const read = target.repo.readBackup(backupJson(backup));
    if (!read.ok) throw new Error('Refused');
    await target.repo.restoreBackup(read.backup);
    expect((await target.repo.getSettings()).privacyMode).toBe(true);

    // And one that's off stays off, even restoring a backup made with it on.
    const other = await setup();
    await other.repo.restoreBackup(read.backup);
    expect((await other.repo.getSettings()).privacyMode).toBe(false);
  });
});
