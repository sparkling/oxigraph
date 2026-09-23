import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Lists index entries `git status` cannot see that still have a file on disk.
 *
 * `skip-worktree` (`S`) and `assume-unchanged` (lowercase, including `s` for
 * both) entries are invisible to `git status`, so a modified file behind one
 * passes a clean check. Such an entry is only harmless when its file is
 * absent: nothing can then be read from it. The E3 oracle relies on exactly
 * that, to present a checkout whose embedded corpus lacks some pinned files.
 *
 * Paths are handled as raw bytes: git still C-quotes a path that is not valid
 * UTF-8 even under `-z`, so decoding the listing as text would turn such a
 * path into one that does not exist and let its file through.
 */
export function hiddenIndexEntriesWithFiles(checkout) {
  const listing = execFileSync(
    "git",
    ["-C", checkout, "-c", "core.quotePath=false", "ls-files", "-v", "-z"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const root = Buffer.from(join(checkout, "/"));
  const present = [];
  let start = 0;
  while (start < listing.length) {
    let end = listing.indexOf(0, start);
    if (end === -1) end = listing.length;
    const entry = listing.subarray(start, end);
    start = end + 1;
    if (entry.length < 3) continue;
    const tag = String.fromCharCode(entry[0]);
    const hidden = tag === "S" || tag !== tag.toUpperCase();
    const path = Buffer.concat([root, entry.subarray(2)]);
    if (hidden && existsSync(path)) present.push(entry.subarray(2).toString("latin1"));
  }
  return present;
}
