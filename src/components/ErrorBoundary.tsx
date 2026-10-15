import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/controls/Button";
import { logFrontendError } from "@/api/diagnostics";

interface Props {
  children: ReactNode;
  /** Changing it clears the error (e.g. the route). */
  resetKey?: string;
}

interface State {
  error: Error | null;
  resetKey?: string;
}

/** Keeps a crashing page from blanking the whole window: the error is
 * logged and the page shows a recoverable message instead. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logFrontendError(error.message, `${error.stack ?? ""}\n${info.componentStack ?? ""}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle size={28} className="text-danger" />
        <div className="text-[15px] font-semibold text-fg">This page ran into a problem</div>
        <p className="max-w-[520px] text-[12.5px] text-fg-muted">
          {this.state.error.message}. It has been written to the log; other pages keep working.
        </p>
        <Button onClick={() => this.setState({ error: null })}>Try again</Button>
      </div>
    );
  }
}
