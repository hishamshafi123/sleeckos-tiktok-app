import type { Metadata } from "next";
import TrackClient from "./TrackClient";

export const metadata: Metadata = {
  title: "Campaign Tracking — Sleeckos",
  description: "Live performance tracking for your campaign.",
  robots: { index: false, follow: false },
};

export default function TrackPage() {
  return <TrackClient />;
}
