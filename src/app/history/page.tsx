export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-8">
      <h1 className="text-2xl font-bold text-white mb-4">Post History</h1>
      <p className="text-gray-500">Your publishing history will appear here.</p>
      <div className="mt-6">
        <Link href="/c/dashboard" className="text-purple-400 hover:text-purple-300 text-sm">← Go to dashboard</Link>
      </div>
    </div>
  );
}
