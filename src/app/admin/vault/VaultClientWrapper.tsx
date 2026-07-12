"use client";
import nextDynamic from "next/dynamic";

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
}: {
  currentUserId: string;
  userRole: string;
}) {
  return <VaultClientPage currentUserId={currentUserId} userRole={userRole} />;
}
