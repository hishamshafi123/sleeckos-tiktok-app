"use client";

import React from "react";
import {
  Bot,
  Mic,
  Keyboard,
  Paperclip,
  MonitorPlay,
  Layers,
  FolderOpen,
  Film,
  Palette,
  FolderKanban,
  GraduationCap,
  Key,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

interface Capability {
  tools: string[];
  description: string;
  confirm?: boolean;
  examples?: string[];
}

interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
  capabilities: Capability[];
}

const HOW_TO_USE = [
  {
    icon: Mic,
    title: "Voice",
    description: "Tap the mic in the panel, speak your request, review the transcript, then send.",
  },
  {
    icon: Keyboard,
    title: "Text",
    description: "Type your request into the panel's input and hit send.",
  },
  {
    icon: Paperclip,
    title: "CSV",
    description: "Attach a sheet of account names, then say what to do with them.",
  },
];

const SECTIONS: Section[] = [
  {
    id: "accounts-posting",
    title: "Accounts & Posting",
    icon: MonitorPlay,
    capabilities: [
      {
        tools: ["search_accounts"],
        description: "Find accounts by name and see color, schedule, health, and Drive folder.",
        examples: ["Show me all accounts with iowa in the name"],
      },
      {
        tools: ["post_now_accounts"],
        description: "Instantly post the next Drive video on a list of accounts.",
        confirm: true,
        examples: [
          "Post now on @iowa_1, @iowa_2",
          "post now on all of these — with a CSV of accounts attached",
        ],
      },
      {
        tools: ["update_account_schedule"],
        description: "Change posting times, days, and timezone.",
        confirm: true,
        examples: ["Set @iowa_1 posting times to 10:00 and 16:00"],
      },
      {
        tools: ["set_posts_per_day"],
        description:
          "Set how many times a day an account posts. Slots are auto-spaced at least 3h apart, the system's minimum gap.",
        confirm: true,
        examples: ["Make @iowa_1 post 3 times a day"],
      },
      {
        tools: ["set_account_color"],
        description: "Change an account's color (drives Smart Export counts).",
        examples: ["Change @iowa_1 color to green"],
      },
    ],
  },
  {
    id: "rendering-multiplier",
    title: "Rendering & Multiplier",
    icon: Layers,
    capabilities: [
      {
        tools: ["get_render_queue_status"],
        description: "See what's rendering now, with counts by status.",
        examples: ["How's the render queue?"],
      },
      {
        tools: ["render_groups"],
        description: "Queue renders for groups by name.",
        confirm: true,
        examples: ["Render groups Iowa A and Iowa B"],
      },
    ],
  },
  {
    id: "campaigns",
    title: "Campaigns",
    icon: FolderOpen,
    capabilities: [
      {
        tools: ["list_campaigns", "get_campaign"],
        description: "Campaign overviews.",
      },
      {
        tools: ["get_campaign_stats"],
        description: "Exported, posted, and failed counts plus success rate.",
        examples: ["How is the Iowa campaign doing?"],
      },
      {
        tools: ["create_campaign", "delete_campaign"],
        description: "Manage campaigns.",
        confirm: true,
      },
    ],
  },
  {
    id: "clip-mixer",
    title: "Clip Mixer",
    icon: Film,
    capabilities: [
      {
        tools: ["generate_clip_mixer_batch"],
        description: "Generate a batch of mixed clips.",
        confirm: true,
      },
      {
        tools: ["render_mix_item"],
        description: "Render a single mix item.",
        confirm: true,
      },
      {
        tools: ["export_batch_archive"],
        description: "Export a finished batch as a downloadable archive.",
        confirm: true,
      },
    ],
  },
  {
    id: "style-studio",
    title: "Style Studio",
    icon: Palette,
    capabilities: [
      {
        tools: ["list_style_templates", "list_saved_styles"],
        description: "Browse style templates and your saved styles.",
      },
      {
        tools: ["create_saved_style", "queue_style_render"],
        description: "Create a saved style or queue a style render.",
        confirm: true,
      },
    ],
  },
  {
    id: "projects",
    title: "Projects",
    icon: FolderKanban,
    capabilities: [
      {
        tools: ["create_project", "add_project_member", "remove_project_member"],
        description: "Create projects and manage members.",
        confirm: true,
      },
      {
        tools: ["create_task", "update_task", "delete_task"],
        description: "Manage project tasks.",
        confirm: true,
      },
      {
        tools: ["send_project_chat"],
        description: "Send a message to a project's chat.",
      },
    ],
  },
  {
    id: "lms",
    title: "LMS",
    icon: GraduationCap,
    capabilities: [
      {
        tools: ["list_courses"],
        description: "List all courses.",
      },
      {
        tools: ["create_course"],
        description: "Create a new course.",
      },
      {
        tools: ["enroll_users_by_course"],
        description: "Enroll users into a course.",
      },
      {
        tools: ["get_enrollment_dashboard"],
        description: "See enrollment progress across users.",
      },
    ],
  },
  {
    id: "access-control",
    title: "Access Control",
    icon: Key,
    capabilities: [
      {
        tools: ["get_user_access"],
        description: "See a user's role and tool access.",
      },
      {
        tools: ["grant_tool", "revoke_tool", "set_user_role"],
        description: "Change a user's tools or role.",
        confirm: true,
      },
    ],
  },
];

function CapabilityCard({ capability }: { capability: Capability }) {
  return (
    <div className="bg-[#18181b] rounded-xl border border-[#27272a] p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          {capability.tools.map((tool) => (
            <code
              key={tool}
              className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300"
            >
              {tool}
            </code>
          ))}
        </div>
        {capability.confirm && (
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-500 whitespace-nowrap">
            Needs confirmation
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed">{capability.description}</p>
      {capability.examples && capability.examples.length > 0 && (
        <div className="mt-auto space-y-1 pt-1">
          {capability.examples.map((example) => (
            <p key={example} className="text-[11px] italic text-zinc-500">
              &ldquo;{example}&rdquo;
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ClientPage() {
  return (
    <div className="flex-1 bg-[#09090b] text-[#fafafa] min-h-screen p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-10">
        {/* Header section */}
        <div className="border-b border-[#27272a] pb-6 space-y-6">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
              <Bot className="text-[#E11D48] w-8 h-8" />
              Sleeck Agent
            </h1>
            <p className="text-[#a1a1aa] text-sm mt-1">
              An AI assistant that runs ops tasks across SleeckOS from the floating chat panel — by voice, text, or CSV.
            </p>
          </div>

          {/* Access note */}
          <div className="bg-[#18181b] rounded-xl border border-[#27272a] p-4 flex items-start gap-3">
            <ShieldAlert className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-zinc-200">Admin-only by default</p>
              <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                The agent is admin-only by default. Admins can grant access in Users &amp; Access &rarr; AI Agent.
              </p>
            </div>
          </div>
        </div>

        {/* How to use */}
        <section id="how-to-use" className="scroll-mt-8 space-y-4">
          <h2 className="font-bold text-sm text-[#a1a1aa] uppercase tracking-wider">How to use</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {HOW_TO_USE.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="bg-[#18181b] rounded-xl border border-[#27272a] p-5 space-y-3"
                >
                  <div className="w-8 h-8 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-zinc-300" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">{item.title}</p>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Capability sections */}
        {SECTIONS.map((section) => {
          const SectionIcon = section.icon;
          return (
            <section key={section.id} id={section.id} className="scroll-mt-8 space-y-4">
              <h2 className="font-bold text-sm text-[#a1a1aa] uppercase tracking-wider flex items-center gap-2">
                <SectionIcon className="w-4 h-4 text-[#E11D48]" />
                {section.title}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {section.capabilities.map((capability) => (
                  <CapabilityCard key={capability.tools.join("-")} capability={capability} />
                ))}
              </div>
            </section>
          );
        })}

        {/* Safety note */}
        <div className="bg-[#18181b] rounded-xl border border-[#27272a] p-5 flex items-start gap-4">
          <ShieldCheck className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-semibold text-zinc-200">Safety &amp; audit trail</p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Actions marked &ldquo;Needs confirmation&rdquo; show an Approve/Deny card in the panel before anything
              runs — nothing executes until you approve it.
            </p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Every action is audit-logged with who asked and what happened, viewable in the panel&apos;s history.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
