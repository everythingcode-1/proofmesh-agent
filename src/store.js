import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'tasks.json');
const MAX_TASKS = 500;

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({ tasks: [] }, null, 2));
}

function safeReadDbFile() {
  ensureDb();

  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
      throw new Error('Invalid DB shape');
    }

    return parsed;
  } catch {
    const corruptedPath = path.join(dataDir, `tasks.corrupted.${Date.now()}.json`);
    try {
      fs.copyFileSync(dbPath, corruptedPath);
    } catch {
      // ignore backup failure; we'll still repair DB to keep service available
    }

    const repaired = { tasks: [] };
    writeDb(repaired);
    return repaired;
  }
}

export function readDb() {
  return safeReadDbFile();
}

export function writeDb(db) {
  ensureDb();

  const normalized = {
    tasks: Array.isArray(db?.tasks) ? db.tasks.slice(0, MAX_TASKS) : []
  };

  const tmpPath = `${dbPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmpPath, dbPath);
}

export function saveTask(task) {
  const db = readDb();
  db.tasks.unshift(task);
  db.tasks = db.tasks.slice(0, MAX_TASKS);
  writeDb(db);
}

export function getTask(id) {
  const db = readDb();
  return db.tasks.find((t) => t.id === id) || null;
}
