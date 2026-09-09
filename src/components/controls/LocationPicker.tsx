import { Folder, FolderSearch2 } from "lucide-react";
import { Button } from "@/components/controls/Button";
import { TextInput } from "@/components/controls/TextInput";
import { toast } from "@/state/toastStore";

interface LocationPickerProps {
  value: string;
  onChange: (value: string) => void;
  network?: boolean;
  placeholder?: string;
  className?: string;
}

/** A folder/network path input with a "Browse..." button. The button is
 * intentionally UI-only in Phase 1 - it surfaces the standard demo-mode
 * notice instead of opening a real OS file picker. */
export function LocationPicker({ value, onChange, network, placeholder, className }: LocationPickerProps) {
  return (
    <div className={className ? className : "flex items-center gap-2"}>
      <TextInput
        icon={network ? FolderSearch2 : Folder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Enter a path..."}
        containerClassName="flex-1"
      />
      <Button size="md" onClick={() => toast.demo()}>
        Browse...
      </Button>
    </div>
  );
}
