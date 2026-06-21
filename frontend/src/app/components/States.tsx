import { Loader2, AlertTriangle, Inbox, Clock } from "lucide-react";

const CB = "#004C97";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
      <Loader2 size={22} className="animate-spin" style={{ color: CB }} />
      <span className="text-[11.5px]">{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <AlertTriangle size={22} className="text-red-500" />
      <span className="text-[12px] font-semibold text-foreground">Couldn’t load data</span>
      <span className="text-[10.5px] text-muted-foreground max-w-xs">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 text-[10.5px] px-3 py-1 rounded border border-border text-muted-foreground hover:bg-secondary transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** Real empty: backend responded, but the pipeline hasn't produced this data yet. */
export function EmptyState({
  title = "Nothing here yet",
  sub = "Pipeline pending — awaiting analysis nodes",
}: {
  title?: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Inbox size={22} className="text-muted-foreground/40" />
      <span className="text-[12px] font-semibold text-foreground">{title}</span>
      <span className="text-[10.5px] text-muted-foreground max-w-xs">{sub}</span>
    </div>
  );
}

/** Coming-soon: this section has no backend source in the current service. */
export function Placeholder({
  title = "Coming soon",
  sub = "This view isn’t connected to a live data source yet.",
}: {
  title?: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center rounded-lg border border-dashed border-border bg-secondary/20">
      <Clock size={20} className="text-muted-foreground/50" />
      <span className="text-[11.5px] font-semibold text-foreground">{title}</span>
      <span className="text-[10px] text-muted-foreground max-w-sm">{sub}</span>
    </div>
  );
}
