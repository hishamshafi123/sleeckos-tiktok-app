import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <>
      <main className="flex-1 flex flex-col items-center text-center px-4 py-20">
        <div className="max-w-3xl space-y-8 mt-[-2rem]">
          <img src="/logo.png" alt="SleeckOS Logo" className="h-40 md:h-48 w-auto mx-auto object-contain" />
          <h1 className="text-5xl font-extrabold tracking-tight lg:text-6xl text-balance">
            Publish your original short-form videos directly to TikTok
          </h1>
          <p className="text-xl text-muted-foreground text-balance mx-auto max-w-2xl">
            With full creator control over privacy, comments, and disclosures. The perfect tool for independent creators and multi-platform publishers.
          </p>
          <div className="pt-4 flex justify-center gap-4">
            <Link href="/login">
              <Button size="lg" className="h-12 px-8 text-lg rounded-full">
                Get Started
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-32 max-w-5xl grid md:grid-cols-3 gap-12 text-left">
          <div className="space-y-3">
            <h3 className="text-xl font-bold">1. Connect</h3>
            <p className="text-muted-foreground">Securely link your TikTok account using the official login flow. We only request the permissions we need.</p>
          </div>
          <div className="space-y-3">
            <h3 className="text-xl font-bold">2. Upload & Customize</h3>
            <p className="text-muted-foreground">Upload your video, pick a cover, and use the fully compliant TikTok composer to set disclosures and privacy.</p>
          </div>
          <div className="space-y-3">
            <h3 className="text-xl font-bold">3. Publish & Track</h3>
            <p className="text-muted-foreground">Post directly to your profile. Track the upload status in real-time right from your dashboard.</p>
          </div>
        </div>
      </main>
    </>
  );
}
