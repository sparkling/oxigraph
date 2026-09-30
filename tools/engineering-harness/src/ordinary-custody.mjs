import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// Reuse Fabric's brief flock admission transaction; model work never holds this lock.
function transaction(directory, action) {
  if (!isAbsolute(directory)) throw new Error("Ordinary custody directory must be absolute");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lease = join(directory, "registry.lease");
  if (lstatSync(directory).isSymbolicLink() || (existsSync(lease) && !lstatSync(lease).isFile())) {
    throw new Error("Invalid ordinary custody directory or lease");
  }
  const fd = openSync(lease, "a", 0o600);
  try {
    execFileSync("flock", ["-w", "5", "3"], { stdio: ["ignore", "pipe", "pipe", fd] });
    return action();
  } finally { closeSync(fd); }
}

/** Claims survive owner crashes; recovery must inspect external native/root actions. */
export function reserveOrdinaryCustody(directory, tasks, overlaps) {
  const path = join(directory, `${randomUUID()}.json`);
  const retained = new Map(tasks.map(task => [task.id, { id: task.id, taskId: task.spec.taskId,
    paths: task.spec.paths, resources: task.resources }]));
  const save = () => {
    if (!retained.size) { if (existsSync(path)) unlinkSync(path); return; }
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ pid: process.pid, outcomes: [...retained.values()] }), { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  };
  transaction(directory, () => {
    for (const name of readdirSync(directory).filter(name => name.endsWith(".json"))) {
      const file = join(directory, name), stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid ordinary custody record");
      const record = JSON.parse(readFileSync(file, "utf8"));
      if (!Number.isSafeInteger(record.pid) || !Array.isArray(record.outcomes)) throw new Error("Invalid ordinary custody record");
      for (const other of record.outcomes) for (const next of retained.values()) {
        if (other.id === next.id || other.taskId === next.taskId
          || other.paths.some(path => next.paths.some(candidate => overlaps(path, candidate)))
          || other.resources.some(resource => next.resources.includes(resource))) {
          throw new Error(`Ordinary pool ownership conflict: ${next.id}; held by ${other.id}, PID ${record.pid}, record ${file}`);
        }
      }
    }
    save();
  });
  return id => transaction(directory, () => { if (retained.delete(id)) save(); });
}
