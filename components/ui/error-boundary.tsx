"use client";

import { Component, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, LifeBuoy, RefreshCw } from "lucide-react";
import { Button } from "./button";

type Props = {
  children: ReactNode;
  module?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundaryCard extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`[ErrorBoundary${this.props.module ? ` · ${this.props.module}` : ""}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="mx-auto grid max-w-md place-items-center gap-4 rounded-2xl border border-danger-500/25 bg-danger-500/[0.04] p-10 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-danger-500/30 bg-danger-500/10">
          <AlertTriangle className="h-5 w-5 text-danger-400" />
        </div>
        <h3 className="text-base font-semibold tracking-tight text-ink">
          Algo salió mal
          {this.props.module && (
            <span className="text-ink-muted"> en {this.props.module}</span>
          )}
        </h3>
        <p className="text-sm text-ink-muted">
          Tuvimos un problema al cargar esta sección. Si el error persiste, contactá soporte.
        </p>
        {this.state.error?.message && (
          <div className="w-full rounded-lg border border-line bg-bg-subtle/60 p-2">
            <code className="break-all text-[10px] text-danger-400">
              {this.state.error.message.slice(0, 200)}
            </code>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              this.setState({ hasError: false, error: null });
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </Button>
          <Link href="/ayuda">
            <Button variant="ghost" size="md">
              <LifeBuoy className="h-4 w-4" />
              Ayuda
            </Button>
          </Link>
        </div>
      </div>
    );
  }
}
