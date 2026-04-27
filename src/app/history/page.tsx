import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";


export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const account = await prisma.tiktokAccount.findFirst({
    where: { userId: session.userId, revokedAt: null }
  });

  if (!account) redirect("/login");

  const jobs = await prisma.publishJob.findMany({
    where: { tiktokAccountId: account.id },
    orderBy: { createdAt: "desc" }
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PUBLISHED":
      case "PUBLISH_COMPLETE": return "bg-green-100 text-green-800 hover:bg-green-100";
      case "FAILED": return "bg-red-100 text-red-800 hover:bg-red-100";
      default: return "bg-yellow-100 text-yellow-800 hover:bg-yellow-100";
    }
  };

  return (
    <>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Publish History</h1>
          <p className="text-muted-foreground">Past publishes and their status.</p>
        </div>

        <div className="border rounded-xl bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Caption</TableHead>
                <TableHead>Privacy</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Link</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No posts found.
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map(job => (
                  <TableRow key={job.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(job.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {job.caption || "No caption"}
                    </TableCell>
                    <TableCell>{job.privacyLevel}</TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(job.status)} variant="outline">
                        {job.status}
                      </Badge>
                      {job.status === "FAILED" && job.failReason && (
                        <p className="text-xs text-destructive mt-1 truncate max-w-[150px]" title={job.failReason}>
                          {job.failReason}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {job.tiktokPostUrl ? (
                        <a href={job.tiktokPostUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          View
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

      </main>
    </>
  );
}
