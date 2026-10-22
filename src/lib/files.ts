import { promises as fs } from "fs";
import path from "path";
import { dataDir, safeName } from "./github";

/** Files that shipped with the current build (the repo's data folder). */
const root = () => path.join(process.cwd(), dataDir());

export async function listBuiltFiles() {
  try {
    const names = await fs.readdir(root());
    const out = [];
    for (const name of names) {
      if (name === ".gitkeep") continue;
      const st = await fs.stat(path.join(root(), name));
      if (st.isFile()) out.push({ name, size: st.size });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function readBuiltFile(name: string) {
  if (safeName(name) !== name) return null;
  try {
    return await fs.readFile(path.join(root(), name));
  } catch {
    return null;
  }
}
