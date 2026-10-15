/** Thin wrapper around the native folder/file picker
 * (`@tauri-apps/plugin-dialog`). Selecting something here only updates
 * frontend state via the caller - it never touches the filesystem
 * itself. Returns `null` on cancel, and gracefully returns `null`
 * rather than throwing when running outside the Tauri runtime (e.g. a
 * plain browser preview). */
import { ask, open, save } from "@tauri-apps/plugin-dialog";

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

/** A native "Save as" dialog; `null` on cancel. */
export async function pickSaveFile(
  defaultPath: string,
  filters: { name: string; extensions: string[] }[] = [],
): Promise<string | null> {
  try {
    const result = await save({ defaultPath, filters });
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}

/** A native yes/no confirmation; `false` outside Tauri. */
export async function confirmAction(message: string, title: string, okLabel = "OK"): Promise<boolean> {
  try {
    return await ask(message, { title, kind: "warning", okLabel, cancelLabel: "Cancel" });
  } catch {
    return false;
  }
}
