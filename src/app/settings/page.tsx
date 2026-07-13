"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Globe, ShieldAlert, Loader2 } from "lucide-react";

const COMMON_TIMEZONES = [
  { value: "Asia/Kolkata", label: "India Standard Time (IST - UTC+5:30)" },
  { value: "UTC", label: "Coordinated Universal Time (UTC)" },
  { value: "America/New_York", label: "Eastern Time (ET - US/Canada)" },
  { value: "America/Chicago", label: "Central Time (CT - US/Canada)" },
  { value: "America/Denver", label: "Mountain Time (MT - US/Canada)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT - US/Canada)" },
  { value: "Europe/London", label: "London / Greenwich Mean Time (GMT/BST)" },
  { value: "Europe/Paris", label: "Central European Time (CET/CEST)" },
  { value: "Asia/Singapore", label: "Singapore Time (SGT - UTC+8)" },
  { value: "Asia/Tokyo", label: "Japan Standard Time (JST - UTC+9)" },
  { value: "Australia/Sydney", label: "Australian Eastern Time (AET)" },
];

export default function SettingsPage() {
  const [open, setOpen] = useState(false);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingTz, setSavingTz] = useState(false);

  useEffect(() => {
    fetch("/api/settings/timezone")
      .then((res) => res.json())
      .then((data) => {
        if (data.timezone) {
          setTimezone(data.timezone);
        }
        setCanEdit(data.canEdit);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load settings:", err);
        setLoading(false);
      });
  }, []);

  const handleDisconnect = async () => {
    window.location.href = "/api/auth/logout";
  };

  const handleTimezoneChange = async (newTz: string) => {
    if (!canEdit) {
      toast.error("Unauthorized: Only administrators can modify the organization timezone.");
      return;
    }
    setSavingTz(true);
    setTimezone(newTz);
    try {
      const res = await fetch("/api/settings/timezone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: newTz }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update timezone");
      toast.success("Organization timezone updated successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to save timezone settings");
    } finally {
      setSavingTz(false);
    }
  };

  return (
    <>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Settings</h1>
          <p className="text-zinc-400 text-sm mt-1">Manage system configurations and your account connection.</p>
        </div>

        {/* Timezone Setting Card */}
        <div className="border border-zinc-800 rounded-2xl p-6 bg-zinc-950/40 backdrop-blur-md space-y-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Organization Timezone</h2>
              <p className="text-zinc-400 text-xs">Defines day boundaries for reporting, scheduling, and employee KPIs.</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-2 text-zinc-500 text-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500" />
              Loading settings...
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              <label className="block text-[10px] uppercase font-bold text-zinc-500">Global Timezone</label>
              <div className="flex items-center gap-3">
                <select
                  value={timezone}
                  disabled={!canEdit || savingTz}
                  onChange={(e) => handleTimezoneChange(e.target.value)}
                  className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs font-semibold text-white focus:outline-none focus:border-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed max-w-md w-full transition-all"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
                {savingTz && <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />}
              </div>
              {!canEdit && (
                <p className="text-[10px] text-zinc-500 flex items-center gap-1.5 mt-1 bg-zinc-950/40 p-2 rounded-lg border border-zinc-900">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                  Read-only. Contact an administrator to change the organization timezone.
                </p>
              )}
            </div>
          )}
        </div>

        {/* TikTok Connection Card */}
        <div className="border border-zinc-800 rounded-2xl p-6 bg-zinc-950/40 backdrop-blur-md space-y-4 shadow-xl">
          <h2 className="text-lg font-bold text-white">TikTok Connection</h2>
          <p className="text-zinc-400 text-xs">Disconnect your TikTok account and revoke all active authentication tokens.</p>
          
          <Button variant="destructive" className="rounded-xl font-bold text-xs" onClick={() => setOpen(true)}>
            Disconnect Account
          </Button>

          <p className="text-[10px] text-zinc-500 mt-2">
            You can also revoke permissions directly from TikTok's <a href="https://www.tiktok.com/setting" className="text-purple-400 hover:underline" target="_blank" rel="noreferrer">Manage app permissions</a> page.
          </p>
        </div>
      </main>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-zinc-950 border border-zinc-800 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-white">Are you sure?</DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs">
              This will log you out and revoke access to publish to your TikTok account. You will need to re-authenticate to post again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" className="border-zinc-850 text-zinc-400 hover:text-white rounded-xl" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" className="rounded-xl" onClick={handleDisconnect}>Yes, disconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
