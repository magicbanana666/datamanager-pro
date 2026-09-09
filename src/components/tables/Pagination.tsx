import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/controls/Button";

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  pageSize?: number;
}

export function Pagination({ page, pageCount, onPageChange, totalItems, pageSize }: PaginationProps) {
  const rangeStart = totalItems && pageSize ? (page - 1) * pageSize + 1 : null;
  const rangeEnd = totalItems && pageSize ? Math.min(page * pageSize, totalItems) : null;

  return (
    <div className="flex items-center justify-between text-xs text-fg-muted">
      {rangeStart !== null ? (
        <span>
          Showing {rangeStart}-{rangeEnd} of {totalItems}
        </span>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
        <span>
          Page {page} of {Math.max(1, pageCount)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={ChevronRight}
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        />
      </div>
    </div>
  );
}
