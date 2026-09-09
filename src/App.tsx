import { HashRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/app-shell/AppShell";
import { OverviewPage } from "@/pages/overview/OverviewPage";
import { DiskAnalysisPage } from "@/pages/disk-analysis/DiskAnalysisPage";
import { FolderAnalysisPage } from "@/pages/folder-analysis/FolderAnalysisPage";
import { NetworkAnalysisPage } from "@/pages/network-analysis/NetworkAnalysisPage";
import { ComparisonPage } from "@/pages/comparison/ComparisonPage";
import { FileSearchPage } from "@/pages/file-search/FileSearchPage";
import { DuplicateFinderPage } from "@/pages/duplicate-finder/DuplicateFinderPage";
import { DataTransferPage } from "@/pages/data-transfer/DataTransferPage";
import { SyncPage } from "@/pages/sync/SyncPage";
import { SchedulerPage } from "@/pages/scheduler/SchedulerPage";
import { ReportsPage } from "@/pages/reports/ReportsPage";
import { ToolsPage } from "@/pages/tools/ToolsPage";
import { IpPortScannerPage } from "@/pages/tools/ip-port-scanner/IpPortScannerPage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/disk-analysis" element={<DiskAnalysisPage />} />
          <Route path="/folder-analysis" element={<FolderAnalysisPage />} />
          <Route path="/network-analysis" element={<NetworkAnalysisPage />} />
          <Route path="/comparison" element={<ComparisonPage />} />
          <Route path="/file-search" element={<FileSearchPage />} />
          <Route path="/duplicate-finder" element={<DuplicateFinderPage />} />
          <Route path="/data-transfer" element={<DataTransferPage />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/scheduler" element={<SchedulerPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/tools/ip-port-scanner" element={<IpPortScannerPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
