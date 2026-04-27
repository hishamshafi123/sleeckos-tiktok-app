import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SleeckOS | Post Direct to TikTok",
  description: "Publish your original short-form videos directly to TikTok with full creator control over privacy, comments, and disclosures.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen flex flex-col bg-background text-foreground">
          {children}
        </div>
        <Toaster />
      </body>
    </html>
  );
}
