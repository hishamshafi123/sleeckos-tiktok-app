import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t py-8 mt-auto">
      <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} TikTok Publisher. Not affiliated with TikTok.</p>
        <div className="flex gap-6">
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>
          <a href="mailto:support@example.com" className="hover:text-foreground transition-colors">
            Contact Support
          </a>
        </div>
      </div>
    </footer>
  );
}
