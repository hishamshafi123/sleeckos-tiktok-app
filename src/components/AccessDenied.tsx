import React from "react";
import Link from "next/link";
import { ShieldAlert, ArrowLeft, GraduationCap } from "lucide-react";

interface AccessDeniedProps {
  tool: string;
}

export default function AccessDenied({ tool }: AccessDeniedProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-md mx-auto text-center px-4 space-y-6">
      {/* Icon Wrapper */}
      <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-red-500 shadow-xl">
        <ShieldAlert className="w-8 h-8" />
      </div>

      {/* Text Info */}
      <div className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight text-zinc-100">Access Denied</h1>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Your current account does not have permission to access the <span className="text-zinc-200 font-semibold">{tool}</span> module.
        </p>
        <p className="text-[11px] text-zinc-500">
          Complete the training modules in the LMS or contact an administrator to request access.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3 w-full justify-center pt-2">
        <Link
          href="/admin/lms"
          className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium transition"
        >
          <GraduationCap className="w-4 h-4" />
          Go to LMS Academy
        </Link>
        <Link
          href="/admin"
          className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-md text-xs font-medium transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
