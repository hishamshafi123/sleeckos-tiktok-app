"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const router = useRouter();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (selected.size > 4 * 1024 * 1024 * 1024) {
      toast.error("File size must be less than 4 GB.");
      return;
    }

    setFile(selected);
    const objectUrl = URL.createObjectURL(selected);
    setPreview(objectUrl);
  };

  const handleContinue = () => {
    if (!file) return;
    
    // Warn if longer than 60s (approx check, duration checked exactly on compose)
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      const durationSecs = Math.round(video.duration);
      if (durationSecs > 60) {
        toast.warning("Your video is longer than 60s. Depending on your account, TikTok may reject it.");
      }
      
      const uploadId = Math.random().toString(36).substring(7);
      router.push(`/preflight/${uploadId}?duration=${durationSecs}`);
    };
    video.src = URL.createObjectURL(file);
  };

  return (
    <>
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Step 1: Select Video</h1>
          <p className="text-muted-foreground mt-2">Upload your video file (MP4, MOV, WebM).</p>
        </div>

        {!file ? (
          <div className="border-2 border-dashed rounded-xl p-12 text-center hover:bg-muted/50 transition-colors">
            <input type="file" id="video-upload" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={handleFileChange} />
            <label htmlFor="video-upload" className="cursor-pointer flex flex-col items-center gap-4">
              <svg className="w-12 h-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
              <div>
                <span className="text-lg font-medium text-primary">Click to upload</span> or drag and drop
              </div>
              <p className="text-sm text-muted-foreground">MP4, MOV, WebM up to 4GB</p>
            </label>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="border rounded-xl overflow-hidden bg-black/5 flex justify-center">
              {preview && (
                <video src={preview} controls className="max-h-[500px]" />
              )}
            </div>
            <div className="flex justify-between items-center bg-card border p-4 rounded-xl">
              <div>
                <p className="font-medium truncate max-w-[200px] md:max-w-md">{file.name}</p>
                <p className="text-sm text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
              <Button variant="outline" onClick={() => { setFile(null); setPreview(null); }}>Change</Button>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-4">
          <Button size="lg" disabled={!file} onClick={handleContinue}>Continue to Composer</Button>
        </div>
      </main>
      <Footer />
    </>
  );
}
