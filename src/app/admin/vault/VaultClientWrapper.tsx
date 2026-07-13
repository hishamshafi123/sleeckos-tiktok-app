"use client";
import React, { Component, ErrorInfo, ReactNode } from "react";
import nextDynamic from "next/dynamic";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-[#09090b] text-red-400 min-h-screen font-mono">
          <h1 className="text-xl font-bold text-red-500 mb-4">Something went wrong on the client side</h1>
          <p className="mb-2 text-zinc-300 font-sans">
            Please copy this error message and paste it to the chat so the AI can fix it:
          </p>
          <pre className="p-4 bg-zinc-900 border border-zinc-800 rounded overflow-auto max-w-full text-sm">
            {this.state.error?.toString()}
            {"\n\nComponent Stack:\n"}
            {this.state.errorInfo?.componentStack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors font-sans"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const VaultClientPage = nextDynamic(() => import("./VaultClientPage"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-[#09090b] text-zinc-400">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
        <span>Loading Data Vault…</span>
      </div>
    </div>
  ),
});

export default function VaultClientWrapper({
  currentUserId,
  userRole,
  hasAccountsEditAccess,
}: {
  currentUserId: string;
  userRole: string;
  hasAccountsEditAccess: boolean;
}) {
  return (
    <ErrorBoundary>
      <VaultClientPage
        currentUserId={currentUserId}
        userRole={userRole}
        hasAccountsEditAccess={hasAccountsEditAccess}
      />
    </ErrorBoundary>
  );
}
