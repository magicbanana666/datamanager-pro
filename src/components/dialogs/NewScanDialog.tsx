import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanSearch } from "lucide-react";
import { Dialog } from "@/components/dialogs/Dialog";
import { Button } from "@/components/controls/Button";
import { RadioGroup } from "@/components/controls/RadioGroup";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { useNetworkScanStore, useScanStore } from "@/state/scanStore";
import { scanOptionsFromSettings } from "@/state/settingsStore";
import { useUiStore } from "@/state/uiStore";
import { toast } from "@/state/toastStore";

type Kind = "disk" | "folder" | "network";

const ROUTES: Record<Kind, string> = {
  disk: "/disk-analysis",
  folder: "/folder-analysis",
  network: "/network-analysis",
};

/** Toolbar > New Scan: pick what to scan and start it on its page. */
export function NewScanDialog() {
  const { newScanOpen, closeNewScan } = useUiStore();
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>("folder");
  const [path, setPath] = useState("");

  function start() {
    const location = path.trim();
    if (!location) {
      toast.warning(kind === "disk" ? "Enter a drive, e.g. C:\\" : "Choose a location first.");
      return;
    }
    const store = kind === "network" ? useNetworkScanStore : useScanStore;
    if (store.getState().status === "scanning") {
      toast.warning("A scan is already running there.");
      return;
    }
    void store.getState().start(location, scanOptionsFromSettings());
    closeNewScan();
    navigate(ROUTES[kind]);
  }

  return (
    <Dialog
      open={newScanOpen}
      onClose={closeNewScan}
      title="New Scan"
      footer={
        <>
          <Button onClick={closeNewScan}>Cancel</Button>
          <Button variant="primary" icon={ScanSearch} onClick={start}>Start Scan</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <RadioGroup
          name="new-scan-kind"
          direction="horizontal"
          value={kind}
          onChange={setKind}
          options={[
            { value: "disk", label: "Whole drive" },
            { value: "folder", label: "Folder" },
            { value: "network", label: "Network share" },
          ]}
        />
        <LocationPicker
          value={path}
          onChange={setPath}
          network={kind === "network"}
          placeholder={kind === "disk" ? "C:\\" : kind === "network" ? "\\\\server\\share" : "Folder to scan"}
        />
        <p className="text-[11.5px] text-fg-muted">
          {kind === "disk"
            ? "Whole NTFS drives are read straight from the MFT when the app runs as administrator - a full C:\\ takes seconds."
            : "Scans only read: nothing is changed."}
        </p>
      </div>
    </Dialog>
  );
}
