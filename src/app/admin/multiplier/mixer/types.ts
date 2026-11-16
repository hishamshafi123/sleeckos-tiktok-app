import type {
  MixerAssetInput,
  MixerLook,
  MixerRecipeSnapshot,
  MixerSettings,
  MixerTextInput,
} from "@/lib/campaign-mixer/schema";
export type Asset = MixerAssetInput & {
  archived: boolean;
  createdAt: string;
  usage: { count: number; lastUsed: string | null };
};
export type TextEntry = MixerTextInput & { archived: boolean };
export type BatchSummary = {
  id: string;
  groupId: string | null;
  name: string;
  status: string;
  requestedCount: number;
  createdAt: string;
  timezone: string;
  counts: Record<string, number>;
};
export type WorkspaceData = {
  workspace: {
    id: string;
    name: string;
    revision: number;
    defaults: MixerSettings;
    draft: Record<string, unknown>;
    campaignId: string | null;
  };
  assets: Asset[];
  texts: TextEntry[];
  looks: MixerLook[];
  batches: BatchSummary[];
};
export type BatchData = Omit<BatchSummary, "counts"> & {
  recipes: {
    id: string;
    outputId: string | null;
    status: string;
    snapshot: MixerRecipeSnapshot;
    output: {
      status: string;
      outputRef: string | null;
      errorMessage: string | null;
      exportStatus: string;
    } | null;
  }[];
};
export const MIXER_API = "/api/multiplier/mixer";
export async function mixerRequest<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${MIXER_API}/${url}`, {
    method,
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const payload = await response.json().catch(() => ({
    error: `The server returned ${response.status}. Retry this action; saved data is retained.`,
  }));
  if (!response.ok)
    throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload as T;
}
export const fieldClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500";
export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:opacity-40 disabled:cursor-not-allowed";
export const primaryClass =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#E11D48] px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 disabled:opacity-40 disabled:cursor-not-allowed";
