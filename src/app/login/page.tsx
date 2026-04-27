import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <>
      <Header />
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full border rounded-2xl p-8 shadow-sm text-center space-y-6">
          <div className="space-y-2">
            <img src="/logo.png" alt="SleeckOS Logo" className="h-32 w-auto mx-auto mb-2 object-contain" />
            <h1 className="text-2xl font-bold">Sign In</h1>
            <p className="text-muted-foreground">Sign in with your TikTok account to start publishing.</p>
          </div>
          
          <form action="/api/auth/tiktok" method="GET">
            <Button type="submit" size="lg" className="w-full bg-black hover:bg-black/90 text-white flex items-center justify-center gap-2">
              <svg fill="currentColor" viewBox="0 0 24 24" className="w-5 h-5"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z"/></svg>
              Continue with TikTok
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-balance">
            You'll be redirected to TikTok to grant permission. We'll never post without your explicit confirmation.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
