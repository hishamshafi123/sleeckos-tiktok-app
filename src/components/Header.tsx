import Link from "next/link";
import { getSession } from "@/lib/session";
import { Button } from "@/components/ui/button";

export default async function Header() {
  const session = await getSession();

  return (
    <header className="border-b sticky top-0 bg-background/80 backdrop-blur z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center overflow-hidden h-10 w-40 relative group">
          <img 
            src="/logo.png" 
            alt="SleeckOS Logo" 
            className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-32 max-w-none object-contain group-hover:opacity-80 transition-opacity" 
          />
        </Link>
        <nav>
          {session ? (
            <Link href="/dashboard">
              <Button variant="default">Dashboard</Button>
            </Link>
          ) : (
            <Link href="/login">
              <Button variant="default">Login</Button>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
