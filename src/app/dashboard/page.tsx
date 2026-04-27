import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";


export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const account = await prisma.tiktokAccount.findFirst({
    where: { userId: session.userId, revokedAt: null },
  });

  if (!account) redirect("/login");

  return (
    <>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl space-y-8">
        
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm flex gap-3 items-center">
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
          <p>
            This app is in sandbox mode. Posts will be private (Only Me) until our TikTok review is complete.
          </p>
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 border rounded-xl bg-card">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={account.avatarUrl} alt={account.displayName} />
              <AvatarFallback>{account.displayName.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-2xl font-bold">{account.displayName}</h2>
              <p className="text-muted-foreground">@{account.username}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/settings">
              <Button variant="outline">Settings</Button>
            </Link>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="border rounded-xl p-8 flex flex-col items-center justify-center text-center gap-4 hover:border-primary transition-colors">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2">Create New Post</h3>
              <p className="text-sm text-muted-foreground mb-6">Upload a video and publish it directly to your TikTok profile.</p>
            </div>
            <Link href="/upload" className="w-full">
              <Button className="w-full">New Post</Button>
            </Link>
          </div>

          <div className="border rounded-xl p-8 flex flex-col items-center justify-center text-center gap-4 hover:border-primary transition-colors">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2">View History</h3>
              <p className="text-sm text-muted-foreground mb-6">Check the status of your recent uploads and past publications.</p>
            </div>
            <Link href="/history" className="w-full">
              <Button variant="outline" className="w-full">View History</Button>
            </Link>
          </div>
        </div>

      </main>
    </>
  );
}
