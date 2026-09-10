/** Thin wrapper around the native folder/file picker
 * (`@tauri-apps/plugin-dialog`). Selecting something here only updates
 * frontend state via the caller - it never touches the filesystem
 * itself. Returns `null` on cancel, and gracefully returns `null`
 * rather than throwing when running outside the Tauri runtime (e.g. a
 * plain browser preview). */
import { open } from "@tauri-apps/plugin-dialog";

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  try {
    const result = await open({ directory: true, multiple: false, defaultPath });
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}

export async function pickFile(defaultPath?: string): Promise<string | null> {
  try {
    const result = await open({ directory: false, multiple: false, defaultPath });
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}
