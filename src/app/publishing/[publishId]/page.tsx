"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PublishingStatusPage() {
  const { publishId } = useParams();
  const router = useRouter();
  const [status, setStatus] = useState("PROCESSING_UPLOAD");
  const [failReason, setFailReason] = useState("");
  const [postUrl, setPostUrl] = useState<string | null>(null);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    
    const pollStatus = async () => {
      try {
        const res = await fetch("/api/tiktok/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publishId })
        });
        const data = await res.json();
        
        if (data.status) {
          setStatus(data.status);
          if (data.failReason) setFailReason(data.failReason);
          if (data.publicPostUrl) setPostUrl(data.publicPostUrl);

          if (data.status === "PUBLISH_COMPLETE" || data.status === "FAILED") {
            return; // Stop polling
          }
        }
      } catch (e) {
        // ignore network error on poll
      }

      timeout = setTimeout(pollStatus, 5000);
    };

    pollStatus();
    return () => clearTimeout(timeout);
  }, [publishId]);

  const mapFailReason = (reason: string) => {
    const map: Record<string, string> = {
      picture_size_check_failed: "Your image doesn't meet TikTok's size requirements.",
      video_pull_failed: "TikTok couldn't fetch your video. Try uploading again.",
      auth_token_expired: "Your TikTok session expired. Please reconnect your account.",
      spam_risk_too_many_posts: "TikTok has temporarily limited posting to this account.",
      spam_risk_user_banned_from_posting: "This account is currently restricted from posting on TikTok.",
      unsupported_format: "This video format isn't supported. Please upload an MP4 (H.264).",
      video_size_check_failed: "This video is too large. Maximum file size is 4 GB.",
      duration_check_failed: "This video is longer than your TikTok account allows.",
      frame_rate_check_failed: "TikTok requires a frame rate between 23 and 60 FPS.",
      internal: "Something went wrong on TikTok's side. Please try again."
    };
    return map[reason] || reason;
  };

  return (
    <>
      <main className="flex-1 container mx-auto px-4 py-16 max-w-xl text-center space-y-8">
        
        {status === "PUBLISH_COMPLETE" ? (
          <div className="space-y-6">
            <div className="w-24 h-24 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <h1 className="text-3xl font-bold">Successfully Posted!</h1>
            <p className="text-muted-foreground">Your video has been published to TikTok.</p>
            {postUrl && (
              <a href={postUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline block mt-4">
                View on TikTok
              </a>
            )}
            <p className="text-xs text-muted-foreground mt-4 italic">Posts may take a few minutes to appear on your TikTok profile.</p>
            
            <div className="pt-8">
              <Link href="/history">
                <Button size="lg">Go to History</Button>
              </Link>
            </div>
          </div>
        ) : status === "FAILED" ? (
          <div className="space-y-6">
            <div className="w-24 h-24 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </div>
            <h1 className="text-3xl font-bold">Publish Failed</h1>
            <p className="text-muted-foreground">We couldn't publish your video.</p>
            <div className="bg-destructive/10 p-4 rounded-xl text-destructive font-medium">
              {mapFailReason(failReason)}
            </div>
            <div className="pt-8 flex justify-center gap-4">
              <Link href="/upload">
                <Button size="lg">Try Again</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="w-24 h-24 border-4 border-muted border-t-primary rounded-full animate-spin mx-auto"></div>
            <h1 className="text-3xl font-bold">Publishing...</h1>
            <p className="text-muted-foreground">Please wait while we process your upload.</p>
            <div className="bg-muted px-4 py-2 rounded-full inline-block text-sm font-medium">
              Status: {status}
            </div>
            <p className="text-xs text-muted-foreground mt-4">Job ID: {publishId}</p>
          </div>
        )}

      </main>
    </>
  );
}
