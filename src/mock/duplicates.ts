import type { DuplicateGroup } from "@/models/duplicates";
import type { CategoryStat } from "@/models/common";

function mb(n: number): number {
  return Math.round(n * 1024 * 1024);
}

export const duplicateGroups: DuplicateGroup[] = [
  {
    id: "g1",
    label: "IMG_20240612_1452.jpg",
    size: mb(248.6),
    type: "JPG File",
    expanded: true,
    files: [
      { id: "g1f1", name: "IMG_20240612_1452.jpg", path: "D:\\Photos\\2024\\", size: mb(248.6), type: "JPG", modified: "2024-06-12T14:52:00", selected: true, isOriginal: true },
      { id: "g1f2", name: "IMG_20240612_1452.jpg", path: "E:\\Backup\\Photos\\", size: mb(248.6), type: "JPG", modified: "2024-06-12T14:52:00", selected: true },
      { id: "g1f3", name: "IMG_20240612_1452 (copy).jpg", path: "D:\\Temp\\", size: mb(248.6), type: "JPG", modified: "2024-06-12T14:52:00", selected: false },
      { id: "g1f4", name: "IMG_20240612_1452.jpg", path: "\\\\NAS\\Photos\\", size: mb(248.6), type: "JPG", modified: "2024-06-12T14:52:00", selected: false },
    ],
  },
  {
    id: "g2",
    label: "Vacation_2023.mp4",
    size: mb(124.3),
    type: "MP4 Video",
    expanded: true,
    files: [
      { id: "g2f1", name: "Vacation_2023.mp4", path: "D:\\Videos\\", size: mb(124.3), type: "MP4", modified: "2023-08-21T10:14:00", selected: true, isOriginal: true },
      { id: "g2f2", name: "Vacation_2023 (1).mp4", path: "E:\\Media\\", size: mb(124.3), type: "MP4", modified: "2023-08-21T10:14:00", selected: false },
      { id: "g2f3", name: "Vacation_2023_copy.mp4", path: "\\\\NAS\\Videos\\", size: mb(124.3), type: "MP4", modified: "2023-08-21T10:14:00", selected: false },
    ],
  },
  {
    id: "g3",
    label: "Project_Plan.pdf",
    size: mb(98.7),
    type: "PDF Document",
    expanded: true,
    files: [
      { id: "g3f1", name: "Project_Plan.pdf", path: "D:\\Projects\\", size: mb(98.7), type: "PDF", modified: "2024-01-16T09:23:00", selected: true, isOriginal: true },
      { id: "g3f2", name: "Project_Plan (1).pdf", path: "E:\\Archive\\", size: mb(98.7), type: "PDF", modified: "2024-01-16T09:23:00", selected: false },
    ],
  },
  {
    id: "g4",
    label: "Screenshot_01.png",
    size: mb(76.1),
    type: "PNG File",
    expanded: false,
    files: [
      { id: "g4f1", name: "Screenshot_01.png", path: "D:\\Screenshots\\", size: mb(15.2), type: "PNG", modified: "2024-03-04T16:11:00", selected: true, isOriginal: true },
      { id: "g4f2", name: "Screenshot_01.png", path: "E:\\Screenshots\\", size: mb(15.2), type: "PNG", modified: "2024-03-04T16:11:00", selected: false },
      { id: "g4f3", name: "Screenshot_01.png", path: "D:\\Temp\\", size: mb(15.2), type: "PNG", modified: "2024-03-04T16:11:00", selected: false },
      { id: "g4f4", name: "Screenshot_01.png", path: "\\\\NAS\\Marketing\\", size: mb(15.2), type: "PNG", modified: "2024-03-04T16:11:00", selected: false },
      { id: "g4f5", name: "Screenshot_01.png", path: "D:\\Old\\", size: mb(15.2), type: "PNG", modified: "2024-03-04T16:11:00", selected: false },
    ],
  },
  {
    id: "g5",
    label: "Report.docx",
    size: mb(62.5),
    type: "DOCX Document",
    expanded: false,
    files: [
      { id: "g5f1", name: "Report.docx", path: "D:\\Reports\\", size: mb(20.83), type: "DOCX", modified: "2024-02-28T11:37:00", selected: true, isOriginal: true },
      { id: "g5f2", name: "Report (final).docx", path: "E:\\Archive\\Reports\\", size: mb(20.83), type: "DOCX", modified: "2024-02-28T11:37:00", selected: false },
      { id: "g5f3", name: "Report - Copy.docx", path: "D:\\Temp\\", size: mb(20.83), type: "DOCX", modified: "2024-02-28T11:37:00", selected: false },
    ],
  },
];

export const duplicateFileTypeStats: CategoryStat[] = [
  { label: "Images", value: mb(6358), percent: 34.2, colorIndex: 3 },
  { label: "Videos", value: mb(5227), percent: 28.1, colorIndex: 2 },
  { label: "Documents", value: mb(3477), percent: 18.7, colorIndex: 4 },
  { label: "Others", value: mb(3530), percent: 19.0, colorIndex: 6 },
];
