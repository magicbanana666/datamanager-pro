import type { SyncRow } from "@/models/sync";

function kb(n: number): number {
  return Math.round(n * 1024);
}
function mb(n: number): number {
  return Math.round(n * 1024 * 1024);
}
function gb(n: number): number {
  return Math.round(n * 1024 * 1024 * 1024);
}

export const initialSyncRows: SyncRow[] = [
  { id: "sy1", fileName: "ProjectPlan.docx", sourcePath: "D:\\Data\\Projects\\", destPath: "E:\\Archive\\Projects\\", size: mb(8.7), modifiedSource: "2026-09-07T14:22:00", modifiedDest: null, action: "copy-new", included: true },
  { id: "sy2", fileName: "Database.xlsx", sourcePath: "D:\\Data\\Projects\\Clients\\", destPath: "E:\\Archive\\Projects\\", size: mb(24.1), modifiedSource: "2026-09-09T14:22:00", modifiedDest: null, action: "copy-new", included: true },
  { id: "sy3", fileName: "Report_2026.pdf", sourcePath: "D:\\Data\\Projects\\Media\\", destPath: "E:\\Archive\\Projects\\Media\\", size: mb(12.4), modifiedSource: "2026-09-08T14:12:00", modifiedDest: "2026-09-06T09:11:00", action: "update-newer", included: true },
  { id: "sy4", fileName: "IMG_20240612.jpg", sourcePath: "D:\\Data\\Projects\\Media\\", destPath: "E:\\Archive\\Projects\\Archive\\", size: mb(248.6), modifiedSource: "2026-09-06T24:33:00", modifiedDest: "2026-09-06T24:33:00", action: "update-newer", included: true },
  { id: "sy5", fileName: "Video_2023.mp4", sourcePath: "D:\\Data\\Projects\\Fcuabive\\", destPath: "E:\\Archive\\Projects\\Aons\\", size: gb(1.2), modifiedSource: "2026-08-08T18:13:00", modifiedDest: "2026-08-30T12:11:00", action: "copy-new", included: true },
  { id: "sy6", fileName: "Archive.zip", sourcePath: "D:\\Data\\Projects\\Docs\\", destPath: "D:\\Data\\Projects\\Archive\\", size: gb(5.8), modifiedSource: "2026-08-28T19:08:00", modifiedDest: "2026-08-28T10:44:00", action: "skip-same", included: true },
  { id: "sy7", fileName: "Notes.txt", sourcePath: "D:\\Data\\Projects\\Fcuabive\\", destPath: "D:\\Data\\Projects\\Archive\\", size: kb(12), modifiedSource: "2026-09-06T19:08:00", modifiedDest: "2026-09-07T11:01:00", action: "update-newer", included: true },
  { id: "sy8", fileName: "OldVersion.pptx", sourcePath: "D:\\Data\\Projects\\Aobive\\", destPath: "D:\\Data\\Projects\\Archive\\", size: mb(4.1), modifiedSource: "2026-07-12T09:14:00", modifiedDest: "2026-07-12T09:14:00", action: "skip-older", included: true },
  { id: "sy9", fileName: "Screenshot.png", sourcePath: "D:\\Data\\Projects\\Archive\\", destPath: "E:\\Archive\\Projectsl\\", size: mb(3.2), modifiedSource: "2026-09-03T19:38:00", modifiedDest: null, action: "copy-new", included: true },
  { id: "sy10", fileName: "TempFile.tmp", sourcePath: "D:\\Data\\Projects\\Tpocs\\", destPath: "D:\\Archive\\Projectl\\amp\\", size: mb(400), modifiedSource: "2026-09-03T18:08:00", modifiedDest: null, action: "exclude-filter", included: false },
];
