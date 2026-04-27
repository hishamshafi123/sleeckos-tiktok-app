"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function ComposePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [creatorInfo, setCreatorInfo] = useState<any>(null);
  const [error, setError] = useState("");

  const [caption, setCaption] = useState("");
  const [privacy, setPrivacy] = useState("");
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [brandYourself, setBrandYourself] = useState(false);
  const [brandThirdParty, setBrandThirdParty] = useState(false);
  const [coverTime, setCoverTime] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("duration")) {
      setVideoDuration(Number(params.get("duration")));
    }
  }, []);

  useEffect(() => {
    fetch("/api/tiktok/creator-info")
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
        } else {
          setCreatorInfo(data);
        }
        setLoading(false);
      });
  }, []);

  const isValid = () => {
    if (!privacy) return false;
    if (disclosureOpen && !brandYourself && !brandThirdParty) return false;
    if (caption.length > 2200) return false;
    if (creatorInfo?.max_video_post_duration_sec && videoDuration > creatorInfo.max_video_post_duration_sec) return false;
    return true;
  };

  const handlePublish = async () => {
    if (creatorInfo?.max_video_post_duration_sec && videoDuration > creatorInfo.max_video_post_duration_sec) {
      toast.error(`Video is too long. Maximum duration is ${creatorInfo.max_video_post_duration_sec} seconds.`);
      return;
    }
    if (brandThirdParty && privacy === "SELF_ONLY") {
      toast.error("Branded content posts cannot be private. Choose 'Everyone' or 'Friends'.");
      return;
    }
    setShowConfirm(true);
  };

  const confirmPublish = async () => {
    setShowConfirm(false);
    toast.info("Publishing to TikTok...");

    try {
      const res = await fetch("/api/tiktok/init-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: caption,
          privacy_level: privacy,
          disable_comment: !allowComment,
          disable_duet: !allowDuet,
          disable_stitch: !allowStitch,
          video_cover_timestamp_ms: coverTime,
          brand_content_toggle: brandThirdParty,
          brand_organic_toggle: brandYourself,
        }),
      });

      const data = await res.json();
      if (data.error) {
        toast.error(`Error: ${data.error}`);
      } else {
        router.push(`/publishing/${data.publishId}`);
      }
    } catch (e) {
      toast.error("Failed to publish");
    }
  };

  if (loading) {
    return (
      <>
        <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl space-y-8">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl text-center">
          <div className="bg-destructive/10 text-destructive p-4 rounded-xl">
            You've reached TikTok's daily posting limit or your account cannot post right now. Please try again later.
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl space-y-10 pb-20">
        
        {creatorInfo?.max_video_post_duration_sec && videoDuration > creatorInfo.max_video_post_duration_sec && (
          <div className="bg-destructive/10 border border-destructive text-destructive p-4 rounded-xl flex items-center gap-3">
            <svg className="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <p className="font-medium text-sm">
              Your video is {videoDuration}s long, but your TikTok account only allows videos up to {creatorInfo.max_video_post_duration_sec}s. Please upload a shorter video.
            </p>
          </div>
        )}

        {/* A. Account header */}
        <div className="flex items-center gap-4 bg-muted/50 p-4 rounded-xl border">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground mb-1">Posting to TikTok as:</p>
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarImage src={creatorInfo?.creator_avatar_url} />
                <AvatarFallback>TK</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-bold">{creatorInfo?.creator_nickname}</p>
                <p className="text-sm text-muted-foreground">@{creatorInfo?.creator_username}</p>
              </div>
            </div>
          </div>
        </div>

        {/* B. Video preview with cover frame picker */}
        <div className="space-y-2">
          <label className="font-semibold block">Cover frame</label>
          <div className="bg-black/5 aspect-video rounded-xl flex items-center justify-center text-muted-foreground border border-dashed">
            [Video Preview Simulation]
          </div>
          <input 
            type="range" 
            min="0" 
            max="10000" 
            value={coverTime} 
            onChange={(e) => setCoverTime(Number(e.target.value))}
            className="w-full accent-primary" 
          />
          <p className="text-xs text-muted-foreground">Select cover frame: {(coverTime/1000).toFixed(1)}s</p>
        </div>

        {/* C. Caption */}
        <div className="space-y-2">
          <label className="font-semibold block">Caption</label>
          <Textarea 
            placeholder="Add a description... #hashtags @mentions" 
            value={caption} 
            onChange={(e) => setCaption(e.target.value)} 
            className="h-32 resize-none"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <p>Add hashtags to help people find your video.</p>
            <p>{caption.length} / 2200</p>
          </div>
        </div>

        {/* D. Privacy */}
        <div className="space-y-2">
          <label className="font-semibold block">Who can view this video</label>
          <Select value={privacy} onValueChange={setPrivacy}>
            <SelectTrigger>
              <SelectValue placeholder="Select privacy" />
            </SelectTrigger>
            <SelectContent>
              {creatorInfo?.privacy_level_options?.map((opt: string) => {
                const label = opt === "PUBLIC_TO_EVERYONE" ? "Everyone" :
                              opt === "MUTUAL_FOLLOW_FRIENDS" ? "Friends" :
                              opt === "FOLLOWER_OF_CREATOR" ? "Followers" : "Only me";
                return <SelectItem key={opt} value={opt}>{label}</SelectItem>
              })}
            </SelectContent>
          </Select>
        </div>

        {/* E. Interactions */}
        <div className="space-y-4 border rounded-xl p-4">
          <label className="font-semibold block">Interactions</label>
          <div className="flex items-center justify-between">
            <label className={`text-sm ${creatorInfo?.comment_disabled ? 'text-muted-foreground' : ''}`}>Allow comments</label>
            <Switch 
              checked={allowComment} 
              onCheckedChange={setAllowComment} 
              disabled={creatorInfo?.comment_disabled} 
            />
          </div>
          {creatorInfo?.comment_disabled && <p className="text-xs text-muted-foreground mt-0">Comments are disabled in your TikTok account settings.</p>}
          
          <div className="flex items-center justify-between">
            <label className={`text-sm ${creatorInfo?.duet_disabled ? 'text-muted-foreground' : ''}`}>Allow Duet</label>
            <Switch 
              checked={allowDuet} 
              onCheckedChange={setAllowDuet} 
              disabled={creatorInfo?.duet_disabled} 
            />
          </div>

          <div className="flex items-center justify-between">
            <label className={`text-sm ${creatorInfo?.stitch_disabled ? 'text-muted-foreground' : ''}`}>Allow Stitch</label>
            <Switch 
              checked={allowStitch} 
              onCheckedChange={setAllowStitch} 
              disabled={creatorInfo?.stitch_disabled} 
            />
          </div>
        </div>

        {/* F. Content disclosure */}
        <div className="space-y-4 border rounded-xl p-4 bg-muted/20">
          <div className="flex items-center justify-between">
            <div>
              <label className="font-semibold block">Disclose content</label>
              <p className="text-sm text-muted-foreground">This post promotes a brand, product, or service</p>
            </div>
            <Switch checked={disclosureOpen} onCheckedChange={setDisclosureOpen} />
          </div>

          {disclosureOpen && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-start space-x-3">
                <Checkbox id="brand-yours" checked={brandYourself} onCheckedChange={(c) => setBrandYourself(!!c)} />
                <div className="grid gap-1.5 leading-none">
                  <label htmlFor="brand-yours" className="font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Your brand
                  </label>
                  <p className="text-sm text-muted-foreground">
                    You are promoting yourself or your own business. Your photo/video will be labeled as 'Promotional content'.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox id="brand-third" checked={brandThirdParty} onCheckedChange={(c) => setBrandThirdParty(!!c)} />
                <div className="grid gap-1.5 leading-none">
                  <label htmlFor="brand-third" className="font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Branded content
                  </label>
                  <p className="text-sm text-muted-foreground">
                    You are promoting another brand or a third party. Your photo/video will be labeled as 'Paid partnership'.
                  </p>
                  {brandThirdParty && (
                    <p className="text-xs text-amber-600 mt-2 p-2 bg-amber-50 rounded">
                      By posting, you agree to TikTok's <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" className="underline" target="_blank" rel="noreferrer">Branded Content Policy</a> and <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" className="underline" target="_blank" rel="noreferrer">Music Usage Confirmation</a>.
                    </p>
                  )}
                </div>
              </div>

              {disclosureOpen && !brandYourself && !brandThirdParty && (
                <p className="text-sm text-destructive font-medium">
                  You need to indicate if your content promotes yourself or a third party.
                </p>
              )}
            </div>
          )}
        </div>

        {/* G. Music Usage Confirmation & H. Publish button */}
        <div className="pt-6 border-t space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            By posting, you agree to TikTok's <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" className="underline font-medium hover:text-primary transition-colors" target="_blank" rel="noreferrer">Music Usage Confirmation</a>.
          </p>
          <Button 
            size="lg" 
            className="w-full text-lg h-14" 
            disabled={!isValid()} 
            onClick={handlePublish}
          >
            Post to TikTok
          </Button>
        </div>

      </main>

      {/* Confirmation Modal */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Publication</DialogTitle>
            <DialogDescription>
              Post this video to @{creatorInfo?.creator_username}'s TikTok account?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={confirmPublish}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
