"use client";
import React, { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  MessageCircle,
  X,
  Send,
  Bot,
  User,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Terminal,
  ChevronDown,
  ChevronUp,
  Clock,
  Zap,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────

interface ToolCallResult {
  toolName: string;
  input: Record<string, any>;
  output: any;
  status: "success" | "denied" | "error";
}

interface PendingConfirmation {
  id: string;
  toolName: string;
  input: Record<string, any>;
  description: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallResult[];
  confirmationRequired?: PendingConfirmation;
  timestamp: Date;
}

// ─── Component ─────────────────────────────────────────

export default function AgentPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // ── Send Message ──

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      // Build conversation history for the API
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          history,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.error || "Something went wrong.",
            timestamp: new Date(),
          },
        ]);
        return;
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.content,
        toolCalls: data.toolCalls,
        confirmationRequired: data.confirmationRequired,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Network error: ${err.message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // ── Confirm/Deny Risky Action ──

  const handleConfirm = async (auditLogId: string, approved: boolean) => {
    setLoading(true);
    try {
      const res = await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId, approved }),
      });

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.content,
          toolCalls: data.toolCalls,
          timestamp: new Date(),
        },
      ]);

      if (approved) {
        toast.success("Action confirmed and executed.");
      } else {
        toast.info("Action cancelled.");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Fetch Audit Log ──

  const fetchAudit = async () => {
    setAuditLoading(true);
    try {
      const res = await fetch("/api/agent/history?limit=30");
      const data = await res.json();
      if (res.ok) setAuditLog(data);
    } catch (err) {
      console.error(err);
    } finally {
      setAuditLoading(false);
    }
  };

  // ── Render ──

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 bg-[#2563eb] hover:bg-blue-600 text-white rounded-full shadow-lg shadow-blue-500/20 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        title="Open Agent"
      >
        <Zap className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] h-[600px] border border-[#27272a] rounded-xl bg-[#09090b] shadow-2xl shadow-black/40 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272a] bg-[#09090b]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white tracking-tight">Sleeckos Agent</h3>
            <p className="text-[9px] text-zinc-500">AI-powered platform control</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setShowAudit(!showAudit);
              if (!showAudit) fetchAudit();
            }}
            className={`p-1.5 rounded-md transition ${
              showAudit
                ? "bg-zinc-800 text-white"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
            }`}
            title="Audit Log"
          >
            <Clock className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-md transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Audit Log View */}
      {showAudit ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 pb-1">
            Recent Agent Actions
          </h4>
          {auditLoading ? (
            <div className="text-zinc-600 text-[10px] text-center py-8">Loading...</div>
          ) : auditLog.length === 0 ? (
            <div className="text-zinc-600 text-[10px] text-center py-8">No agent actions yet.</div>
          ) : (
            auditLog.map((entry) => (
              <div
                key={entry.id}
                className="border border-[#27272a] rounded-md p-2.5 bg-[#121214] space-y-1"
              >
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-zinc-200 font-mono">
                    {entry.toolName}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border ${
                      entry.status === "success"
                        ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/40"
                        : entry.status === "denied"
                        ? "bg-red-950/20 text-red-400 border-red-900/40"
                        : entry.status === "confirmed"
                        ? "bg-blue-950/20 text-blue-400 border-blue-900/40"
                        : entry.status === "pending_confirmation"
                        ? "bg-amber-950/20 text-amber-400 border-amber-900/40"
                        : "bg-zinc-900/20 text-zinc-400 border-zinc-800"
                    }`}
                  >
                    {entry.status}
                  </span>
                </div>
                <p className="text-[9px] text-zinc-500 truncate">{entry.instruction}</p>
                <div className="flex justify-between items-center">
                  <span className="text-[8px] text-zinc-600">
                    {entry.user?.name || entry.user?.email}
                  </span>
                  <span className="text-[8px] text-zinc-600">
                    {new Date(entry.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3 pb-10">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600/20 to-indigo-600/20 border border-blue-900/30 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-blue-400" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-zinc-300">What can I help with?</p>
                  <p className="text-[10px] text-zinc-500 max-w-[280px] leading-relaxed">
                    I can manage campaigns, render clips, create tasks, enroll users in courses, and more — all via natural language.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5 pt-2">
                  {[
                    "List all campaigns",
                    "Create a project task",
                    "Show enrollment dashboard",
                    "Who has clip_mixer access?",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion);
                        setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                      className="px-2.5 py-1 text-[9px] font-semibold bg-[#121214] border border-[#27272a] text-zinc-400 rounded-full hover:text-white hover:border-zinc-600 transition"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className="space-y-2">
                {/* Message Bubble */}
                <div
                  className={`flex gap-2.5 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-3 h-3 text-white" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] px-3 py-2 rounded-lg text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-[#2563eb] text-white rounded-br-sm"
                        : "bg-[#121214] border border-[#27272a] text-zinc-200 rounded-bl-sm"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  {msg.role === "user" && (
                    <div className="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User className="w-3 h-3 text-zinc-400" />
                    </div>
                  )}
                </div>

                {/* Tool Call Results */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="ml-8 space-y-1.5">
                    {msg.toolCalls.map((tc, j) => (
                      <ToolCallCard key={j} toolCall={tc} />
                    ))}
                  </div>
                )}

                {/* Confirmation Required */}
                {msg.confirmationRequired && (
                  <div className="ml-8">
                    <ConfirmationCard
                      confirmation={msg.confirmationRequired}
                      onConfirm={handleConfirm}
                      disabled={loading}
                    />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex gap-2.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-3 h-3 text-white" />
                </div>
                <div className="bg-[#121214] border border-[#27272a] rounded-lg px-3 py-2.5 rounded-bl-sm">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={sendMessage}
            className="border-t border-[#27272a] p-3 bg-[#09090b]"
          >
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                placeholder="Ask the agent..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
                className="flex-1 bg-[#121214] border border-[#27272a] rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 transition disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="px-3 py-2 bg-[#2563eb] text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

// ─── Sub-Components ────────────────────────────────────

function ToolCallCard({ toolCall }: { toolCall: ToolCallResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`border rounded-md text-[10px] overflow-hidden ${
        toolCall.status === "success"
          ? "border-emerald-900/40 bg-emerald-950/10"
          : toolCall.status === "denied"
          ? "border-red-900/40 bg-red-950/10"
          : "border-zinc-800 bg-zinc-900/20"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-white/[0.02] transition"
      >
        <div className="flex items-center gap-1.5">
          {toolCall.status === "success" ? (
            <CheckCircle className="w-3 h-3 text-emerald-400" />
          ) : toolCall.status === "denied" ? (
            <Shield className="w-3 h-3 text-red-400" />
          ) : (
            <XCircle className="w-3 h-3 text-zinc-400" />
          )}
          <span className="font-mono font-bold text-zinc-300">{toolCall.toolName}</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-zinc-500" />
        ) : (
          <ChevronDown className="w-3 h-3 text-zinc-500" />
        )}
      </button>

      {expanded && (
        <div className="px-2.5 pb-2 space-y-1 border-t border-[#27272a]/50">
          <div className="pt-1.5">
            <span className="text-[8px] text-zinc-500 uppercase font-bold">Input</span>
            <pre className="text-[9px] text-zinc-400 bg-[#09090b] p-1.5 rounded mt-0.5 overflow-x-auto max-h-20 overflow-y-auto">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          <div>
            <span className="text-[8px] text-zinc-500 uppercase font-bold">Output</span>
            <pre className="text-[9px] text-zinc-400 bg-[#09090b] p-1.5 rounded mt-0.5 overflow-x-auto max-h-20 overflow-y-auto">
              {JSON.stringify(toolCall.output, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmationCard({
  confirmation,
  onConfirm,
  disabled,
}: {
  confirmation: PendingConfirmation;
  onConfirm: (id: string, approved: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="border border-amber-900/40 bg-amber-950/10 rounded-md p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
          Confirmation Required
        </span>
      </div>

      <div className="text-[10px] text-zinc-300 space-y-1">
        <div className="font-mono font-bold text-zinc-200">{confirmation.toolName}</div>
        <pre className="text-[9px] text-zinc-400 bg-[#09090b] border border-zinc-800/50 p-2 rounded overflow-x-auto max-h-24 overflow-y-auto">
          {JSON.stringify(confirmation.input, null, 2)}
        </pre>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(confirmation.id, true)}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-emerald-600 text-white rounded-md text-[10px] font-bold hover:bg-emerald-500 transition disabled:opacity-40"
        >
          <CheckCircle className="w-3 h-3" />
          Approve
        </button>
        <button
          onClick={() => onConfirm(confirmation.id, false)}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-md text-[10px] font-bold hover:bg-zinc-700 transition disabled:opacity-40"
        >
          <XCircle className="w-3 h-3" />
          Deny
        </button>
      </div>
    </div>
  );
}
