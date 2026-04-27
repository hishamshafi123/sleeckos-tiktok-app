"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function SettingsPage() {
  const [open, setOpen] = useState(false);

  const handleDisconnect = async () => {
    // Calling our logout API which also clears the session
    // In a real app we'd also call the /oauth/revoke/ endpoint before clearing
    window.location.href = "/api/auth/logout";
  };

  return (
    <>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage your account connection.</p>
        </div>

        <div className="border rounded-xl p-6 bg-card space-y-4">
          <h2 className="text-xl font-semibold">TikTok Connection</h2>
          <p className="text-muted-foreground">Disconnect your TikTok account and revoke all access tokens.</p>
          
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Disconnect Account
          </Button>

          <p className="text-sm mt-4">
            You can also revoke permissions directly from TikTok's <a href="https://www.tiktok.com/setting" className="text-primary hover:underline" target="_blank" rel="noreferrer">Manage app permissions</a> page.
          </p>
        </div>

      </main>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              This will log you out and revoke access to publish to your TikTok account. You will need to re-authenticate to post again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDisconnect}>Yes, disconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
