import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Folder, FolderSearch2, Loader2 } from "lucide-react";
import { Button } from "@/components/controls/Button";
import { TextInput } from "@/components/controls/TextInput";
import { pickFolder } from "@/api/dialog";
import { validatePath } from "@/api/backend";
import type { PathValidation } from "@/models/backend";

interface LocationPickerProps {
  value: string;
  onChange: (value: string) => void;
  network?: boolean;
  placeholder?: string;
  className?: string;
  /** Set false to skip the live path-validation indicator (e.g. for a
   * search-term-like field that happens to reuse this component). */
  validate?: boolean;
}

type ValidationState = "idle" | "checking" | "valid" | "invalid";

/** Path input with a folder picker and a debounced validity check
 * (`validate_path`). */
export function LocationPicker({ value, onChange, network, placeholder, className, validate = true }: LocationPickerProps) {
  const [state, setState] = useState<ValidationState>("idle");
  const [result, setResult] = useState<PathValidation | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const requestId = useRef(0);

  useEffect(() => {
    if (!validate || !value.trim()) return;
    window.clearTimeout(debounceRef.current);
    const id = ++requestId.current;
    debounceRef.current = window.setTimeout(() => {
      setState("checking");
      validatePath(value)
        .then((r) => {
          if (requestId.current !== id) return;
          setResult(r);
          setState(r.exists && r.accessible ? "valid" : "invalid");
        })
        .catch(() => {
          if (requestId.current !== id) return;
          setState("invalid");
        });
    }, 400);
    return () => window.clearTimeout(debounceRef.current);
  }, [value, validate]);

  async function handleBrowse() {
    const picked = await pickFolder(value || undefined);
    if (picked) onChange(picked);
  }

  // Derived rather than stored: an empty field is always "idle"
  // regardless of whatever the last debounced check happened to leave
  // in state, and it avoids needing a synchronous setState on every
  // keystroke that clears the field.
  const displayState: ValidationState = value.trim() ? state : "idle";

  const statusTitle =
    displayState === "valid"
      ? "Path exists and is accessible."
      : displayState === "invalid"
        ? result?.error?.message ?? "Path could not be validated."
        : undefined;

  return (
    <div className={className ? className : "flex items-center gap-2"}>
      <TextInput
        icon={network ? FolderSearch2 : Folder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Enter a path..."}
        containerClassName="flex-1"
      />
      {validate && (
        <span className="flex h-8 w-5 shrink-0 items-center justify-center" title={statusTitle}>
          {displayState === "checking" && <Loader2 size={14} className="animate-spin text-fg-subtle" />}
          {displayState === "valid" && <CheckCircle2 size={14} className="text-success" />}
          {displayState === "invalid" && <AlertTriangle size={14} className="text-warning" />}
        </span>
      )}
      <Button size="md" onClick={handleBrowse}>
        Browse...
      </Button>
    </div>
  );
}
