import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sleeckos — UGC Creator Marketplace",
  description: "Where verified brands connect with vetted TikTok creators for transparent, TikTok-compliant branded content campaigns.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} min-h-screen bg-[#0a0a0f] text-white antialiased`}>
        {children}
        <Toaster theme="dark" />
      </body>
    </html>
  );
}
