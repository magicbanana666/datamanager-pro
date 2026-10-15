/** The file search's single global run - see `createJobStore`. */
import { cancelFileSearch, generateSearchId, startFileSearch } from "@/api/search";
import type { SearchRequest, SearchResult } from "@/models/search";
import { createJobStore } from "@/state/createJobStore";
import { formatNumber } from "@/utils/format";

export const useSearchStore = createJobStore<SearchResult, [location: string, options: SearchRequest]>({
  eventPrefix: "search",
  generateId: generateSearchId,
  startJob: startFileSearch,
  cancelJob: cancelFileSearch,
  describeResult: (result) => [
    `${formatNumber(result.totalHits)} matches in ${formatNumber(result.filesSearched)} files.`,
    "Search complete",
  ],
  cancelledMessage: "Search cancelled.",
});
