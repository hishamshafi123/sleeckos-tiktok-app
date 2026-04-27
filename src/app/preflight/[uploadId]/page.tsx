"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

export default function PreflightPage() {
  const { uploadId } = useParams();
  const searchParams = useSearchParams();
  const duration = Number(searchParams.get("duration") || 0);
  const router = useRouter();
  
  const [analyzing, setAnalyzing] = useState(true);
  const [transcoding, setTranscoding] = useState(false);
  const [progress, setProgress] = useState(0);
  
  const [transcribeEnabled, setTranscribeEnabled] = useState(false);

  useEffect(() => {
    // Simulate pre-flight analysis
    const t = setTimeout(() => setAnalyzing(false), 2000);
    return () => clearTimeout(t);
  }, []);

  const handleTranscode = () => {
    setTranscoding(true);
    let p = 0;
    const interval = setInterval(() => {
      p += 10;
      setProgress(p);
      if (p >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          setTranscoding(false);
          toast.success("Transcoding complete");
        }, 500);
      }
    }, 300);
  };

  const handleContinue = () => {
    router.push(`/compose?duration=${duration}`);
  };

  return (
    <>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl space-y-8 pb-20">
        <div>
          <h1 className="text-3xl font-bold">Pre-flight Check</h1>
          <p className="text-muted-foreground mt-2">Analyzing your source file for TikTok compatibility.</p>
        </div>

        {analyzing ? (
          <div className="border rounded-xl p-12 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p>Analyzing codec, bitrate, and loudness...</p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid md:grid-cols-2 gap-8">
              
              {/* Left Column: Specs & Actions */}
              <div className="space-y-6">
                <div className="border rounded-xl p-6 bg-card space-y-4">
                  <h2 className="text-xl font-semibold">Source Specs</h2>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Codec</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">HEVC / H.265</span>
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Resolution</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">3840x2160 (16:9)</span>
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Frame Rate</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">29.97 fps</span>
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Loudness</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">-18 LUFS</span>
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      </div>
                    </div>
                  </div>

                  {transcoding ? (
                    <div className="pt-4 border-t space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Transcoding to H.264 1080p...</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }}></div>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-4 border-t">
                      <p className="text-sm text-muted-foreground mb-3">
                        TikTok prefers H.264 MP4s in 9:16 vertical format. We recommend transcoding this file before publishing.
                      </p>
                      <Button onClick={handleTranscode} className="w-full">
                        Transcode & Normalize Audio
                      </Button>
                    </div>
                  )}
                </div>

                <div className="border rounded-xl p-6 bg-card space-y-4">
                  <h2 className="text-xl font-semibold">Accessibility Helper</h2>
                  <p className="text-sm text-muted-foreground">
                    Auto-transcribe the spoken audio in your video to create assistive captions. You can review and edit them before burning them in.
                  </p>
                  {transcribeEnabled ? (
                    <div className="bg-muted p-3 rounded text-sm text-muted-foreground italic">
                      [Transcription simulation complete. Edit captions mode enabled.]
                    </div>
                  ) : (
                    <Button variant="outline" onClick={() => {
                      setTranscribeEnabled(true);
                      toast.success("Transcribing audio...");
                    }} className="w-full">
                      Generate Assistive Captions
                    </Button>
                  )}
                </div>
              </div>

              {/* Right Column: Safe Zone Preview */}
              <div className="border rounded-xl p-6 bg-card space-y-4 flex flex-col items-center">
                <h2 className="text-xl font-semibold self-start">Safe Zone Preview</h2>
                <p className="text-sm text-muted-foreground self-start mb-4">
                  Preview how TikTok's UI overlays will look. Drag the crop window to set your 9:16 center.
                </p>
                
                <div className="relative w-64 h-[455px] bg-black rounded-md overflow-hidden border">
                  {/* Simulated 16:9 video cropped to 9:16 */}
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 font-bold text-2xl">
                    VIDEO
                  </div>
                  
                  {/* TikTok Safe Zones Overlay */}
                  <div className="absolute top-0 inset-x-0 h-[100px] bg-gradient-to-b from-black/60 to-transparent pointer-events-none"></div>
                  <div className="absolute bottom-0 inset-x-0 h-[150px] bg-gradient-to-t from-black/80 to-transparent pointer-events-none flex items-end p-4">
                    <div className="text-white/80 text-xs w-3/4">
                      <div className="font-bold mb-1">@creator_name</div>
                      <div className="line-clamp-2">Your amazing caption will appear here, covering this part of the video...</div>
                    </div>
                  </div>
                  <div className="absolute right-0 bottom-20 w-12 h-64 bg-black/20 flex flex-col items-center justify-end pb-4 gap-4 pointer-events-none">
                    <div className="w-8 h-8 rounded-full bg-white/20"></div>
                    <div className="w-8 h-8 rounded-full bg-white/20"></div>
                    <div className="w-8 h-8 rounded-full bg-white/20"></div>
                    <div className="w-8 h-8 rounded-full bg-white/20"></div>
                  </div>
                </div>
              </div>

            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button size="lg" onClick={handleContinue}>
                Continue to Post
              </Button>
            </div>
          </div>
        )}

      </main>
    </>
  );
}
