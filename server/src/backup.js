import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';

/**
 * Sauvegardes automatiques de la base.
 *
 * SQLite est un fichier : le copier pendant que le serveur écrit dedans peut
 * produire une copie corrompue. On utilise donc la commande VACUUM INTO, qui
 * écrit un fichier cohérent même sous charge.
 *
 * Une sauvegarde au démarrage, puis une toutes les 24 h. Les BACKUP_KEEP
 * dernières sont conservées, les plus anciennes supprimées.
 */

const KEEP = Number(process.env.BACKUP_KEEP || 7);
const INTERVAL_MS = Number(process.env.BACKUP_INTERVAL_MS || 24 * 60 * 60 * 1000);

const backupDir = path.join(path.dirname(config.databaseFile), 'backups');

export function runBackup() {
  try {
    fs.mkdirSync(backupDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = path.join(backupDir, `footix-${stamp}.db`);

    // VACUUM INTO refuse d'écraser un fichier existant : pas de risque.
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith('footix-') && f.endsWith('.db'))
      .sort()
      .reverse();

    for (const old of files.slice(KEEP)) {
      fs.unlinkSync(path.join(backupDir, old));
    }

    const size = (fs.statSync(target).size / 1024).toFixed(0);
    console.log(`  → sauvegarde : ${path.basename(target)} (${size} Ko, ${Math.min(files.length, KEEP)} conservées)`);
    return target;
  } catch (err) {
    console.error('[backup] échec :', err.message);
    return null;
  }
}

export function scheduleBackups() {
  if (INTERVAL_MS <= 0) return;
  runBackup();
  const timer = setInterval(runBackup, INTERVAL_MS);
  timer.unref?.();
}
