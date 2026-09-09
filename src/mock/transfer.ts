import type { TransferFileRow } from "@/models/transfer";

function mb(n: number): number {
  return Math.round(n * 1024 * 1024);
}
function gb(n: number): number {
  return Math.round(n * 1024 * 1024 * 1024);
}

/** The initial (pre-scan) file list for the Data Transfer page. Rows get
 * mutated in place by useSimulatedProgress as the fake transfer "runs". */
export const initialTransferFiles: TransferFileRow[] = [
  { id: "tf1", status: "done", fileName: "Report_2026.pdf", sourcePath: "D:\\Data\\Projects\\Clients\\", destPath: "E:\\Archive\\Projects\\Clients\\", size: mb(12.4), progress: 100, speedBps: 0, etaSeconds: 0 },
  { id: "tf2", status: "done", fileName: "ProjectPlan.xlsx", sourcePath: "D:\\Data\\Projects\\", destPath: "E:\\Archive\\Projects\\", size: mb(8.7), progress: 100, speedBps: 0, etaSeconds: 0 },
  { id: "tf3", status: "done", fileName: "Database.bak", sourcePath: "D:\\Data\\Database\\", destPath: "E:\\Archive\\Database\\", size: gb(4.2), progress: 100, speedBps: 0, etaSeconds: 0 },
  { id: "tf4", status: "in-progress", fileName: "IMG_20240612.jpg", sourcePath: "D:\\Data\\Media\\Photos\\", destPath: "E:\\Archive\\Media\\Photos\\", size: mb(248.6), progress: 67, speedBps: mb(105), etaSeconds: 18 },
  { id: "tf5", status: "queued", fileName: "Video_2023.mp4", sourcePath: "D:\\Data\\Media\\Videos\\", destPath: "E:\\Archive\\Media\\Videos\\", size: gb(1.2), progress: 34, speedBps: mb(92), etaSeconds: 62 },
  { id: "tf6", status: "queued", fileName: "Archive.zip", sourcePath: "D:\\Data\\Backups\\", destPath: "E:\\Archive\\Backups\\", size: gb(5.8), progress: 0, speedBps: 0, etaSeconds: null },
  { id: "tf7", status: "queued", fileName: "ISO_Win11.iso", sourcePath: "D:\\Data\\ISO\\", destPath: "E:\\Archive\\ISO\\", size: gb(5.1), progress: 0, speedBps: 0, etaSeconds: null },
  { id: "tf8", status: "queued", fileName: "Logs_2026.zip", sourcePath: "D:\\Data\\Logs\\", destPath: "E:\\Archive\\Logs\\", size: mb(780), progress: 0, speedBps: 0, etaSeconds: null },
];

export const transferSpeedHistorySeed = Array.from({ length: 24 }, (_, i) => ({
  t: i,
  mbps: 60 + Math.round(Math.sin(i / 3) * 25 + Math.random() * 20),
}));
