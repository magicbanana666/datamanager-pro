import type {
  ComparisonResultTotals,
  ComparisonRow,
  ComparisonSummary,
} from "@/models/comparison";
import type { CategoryStat } from "@/models/common";

function gb(n: number): number {
  return Math.round(n * 1024 * 1024 * 1024);
}
function mb(n: number): number {
  return Math.round(n * 1024 * 1024);
}

export const comparisonSummaryA: ComparisonSummary = {
  location: "D:\\Data\\Projects",
  totalBytes: gb(286.1),
  files: 124582,
  folders: 12341,
  lastModified: "2026-09-07T10:11:00",
};

export const comparisonSummaryB: ComparisonSummary = {
  location: "E:\\Archive\\Projects",
  totalBytes: gb(312.8),
  files: 132485,
  folders: 14226,
  lastModified: "2026-09-06T22:15:00",
};

export const comparisonTotals: ComparisonResultTotals = {
  identicalFiles: 98421,
  differentFiles: 12453,
  leftOnly: 8124,
  rightOnly: 7891,
  differentDataBytes: gb(45.6),
  leftOnlyBytes: gb(28.4),
  rightOnlyBytes: gb(31.2),
};

export const comparisonFileTypesA: CategoryStat[] = [
  { label: "Documents", value: gb(91.9), percent: 32.1, colorIndex: 4 },
  { label: "Images", value: gb(51.5), percent: 18.0, colorIndex: 3 },
  { label: "Videos", value: gb(36.3), percent: 12.7, colorIndex: 2 },
  { label: "Archives", value: gb(29.2), percent: 10.2, colorIndex: 1 },
  { label: "Executables", value: gb(14.6), percent: 5.1, colorIndex: 7 },
  { label: "Others", value: gb(61.5), percent: 21.5, colorIndex: 6 },
];

export const comparisonFileTypesB: CategoryStat[] = [
  { label: "Documents", value: gb(93.5), percent: 29.9, colorIndex: 4 },
  { label: "Images", value: gb(69.1), percent: 22.1, colorIndex: 3 },
  { label: "Videos", value: gb(44.8), percent: 14.3, colorIndex: 2 },
  { label: "Archives", value: gb(27.6), percent: 8.8, colorIndex: 1 },
  { label: "Executables", value: gb(19.7), percent: 6.3, colorIndex: 7 },
  { label: "Others", value: gb(58.1), percent: 18.6, colorIndex: 6 },
];

export const sizeComparisonByType = [
  { type: "Documents", a: gb(91.9), b: gb(93.5) },
  { type: "Images", a: gb(51.5), b: gb(69.1) },
  { type: "Videos", a: gb(36.3), b: gb(44.8) },
  { type: "Archives", a: gb(29.2), b: gb(27.6) },
  { type: "Executables", a: gb(14.6), b: gb(19.7) },
  { type: "Others", a: gb(61.5), b: gb(58.1) },
];

export const fileCountComparisonByType = [
  { type: "Documents", a: 34500, b: 36700 },
  { type: "Images", a: 21200, b: 23800 },
  { type: "Videos", a: 3100, b: 3450 },
  { type: "Archives", a: 8600, b: 8100 },
  { type: "Executables", a: 4200, b: 4650 },
  { type: "Others", a: 52982, b: 55785 },
];

export const comparisonRows: ComparisonRow[] = [
  { id: "c1", status: "different", name: "ProjectPlan.docx", pathA: "D:\\Data\\Projects\\ClientA\\", pathB: "E:\\Archive\\Projects\\ClientA\\", sizeA: mb(2.4), sizeB: mb(2.6), modifiedA: "2026-09-01T10:12:00", modifiedB: "2026-09-05T14:33:00", category: "Documents" },
  { id: "c2", status: "left-only", name: "Budget.xlsx", pathA: "D:\\Data\\Projects\\ClientB\\", pathB: null, sizeA: mb(1.8), sizeB: null, modifiedA: "2026-09-03T09:14:00", modifiedB: null, category: "Documents" },
  { id: "c3", status: "right-only", name: "OldVersion.pptx", pathA: null, pathB: "E:\\Archive\\Projects\\ClientB\\", sizeA: null, sizeB: mb(4.1), modifiedA: null, modifiedB: "2026-08-28T16:22:00", category: "Documents" },
  { id: "c4", status: "identical", name: "Logo.png", pathA: "D:\\Data\\Projects\\Media\\", pathB: "E:\\Archive\\Projects\\Media\\", sizeA: 245 * 1024, sizeB: 245 * 1024, modifiedA: "2026-07-10T11:21:00", modifiedB: "2026-07-10T11:21:00", category: "Images" },
  { id: "c5", status: "different", name: "Database.zip", pathA: "D:\\Data\\Projects\\Archive\\", pathB: "E:\\Archive\\Projects\\Archive\\", sizeA: mb(812), sizeB: mb(799), modifiedA: "2026-06-21T08:44:00", modifiedB: "2026-08-15T19:02:00", category: "Archives" },
  { id: "c6", status: "left-only", name: "Notes.txt", pathA: "D:\\Data\\Projects\\ClientC\\", pathB: null, sizeA: 12 * 1024, sizeB: null, modifiedA: "2026-09-06T13:11:00", modifiedB: null, category: "Documents" },
  { id: "c7", status: "right-only", name: "Report_2025.pdf", pathA: null, pathB: "E:\\Archive\\Projects\\ClientC\\", sizeA: null, sizeB: mb(6.7), modifiedA: null, modifiedB: "2026-09-02T17:36:00", category: "Documents" },
  { id: "c8", status: "identical", name: "Setup.exe", pathA: "D:\\Data\\Projects\\Tools\\", pathB: "E:\\Archive\\Projects\\Tools\\", sizeA: mb(54.2), sizeB: mb(54.2), modifiedA: "2026-05-14T10:55:00", modifiedB: "2026-05-14T10:55:00", category: "Executables" },
  { id: "c9", status: "different", name: "Presentation.pptx", pathA: "D:\\Data\\Projects\\ClientA\\", pathB: "E:\\Archive\\Projects\\ClientA\\", sizeA: mb(18.4), sizeB: mb(19.1), modifiedA: "2026-08-30T12:00:00", modifiedB: "2026-09-01T08:15:00", category: "Documents" },
  { id: "c10", status: "identical", name: "Icon.ico", pathA: "D:\\Data\\Projects\\Media\\", pathB: "E:\\Archive\\Projects\\Media\\", sizeA: 32 * 1024, sizeB: 32 * 1024, modifiedA: "2026-04-02T09:00:00", modifiedB: "2026-04-02T09:00:00", category: "Images" },
];
