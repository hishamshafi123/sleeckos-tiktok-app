export const dynamic = "force-dynamic";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

// Groups were removed — accounts now belong directly to Sections.
// Redirect the old /admin/accounts/[sectionSlug]/[groupSlug] URLs to the
// parent section page. (Permanent nav cleanup happens in a later task.)
export default async function Page(props: any) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { sectionSlug } = await props.params;
  redirect(`/admin/accounts/${sectionSlug}`);
}
