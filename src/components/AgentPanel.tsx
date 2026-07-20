"use client";
import React, { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  X,
  Bot,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Sparkles,
  Mic,
  Paperclip,
  ArrowUp,
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

// ─── Web Speech API (minimal local types — lib.dom lacks them) ───

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ─── Helpers ───────────────────────────────────────────

const ACCENT = "#E11D48";

const SUGGESTIONS = [
  "Post now on @acc1, @acc2",
  "Set @acc1 to 3 posts/day",
  "Change @acc1 color to green",
  "Set @acc1 posting times to 10:00, 16:00",
  "Render queue status",
  "Stats for campaign…",
];

const MAX_ATTACH_ACCOUNTS = 100;

// Dumb client-side CSV/txt parser: pull out plausible account usernames.
function parseAccountsFromText(text: string): string[] {
  const tokens = text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[,;\t]/));

  const accounts: string[] = [];
  for (const raw of tokens) {
    const token = raw
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/^@+/, "")
      .trim();
    if (!token) continue;
    // Drop header cells like "account" / "username"
    if (/^(account|accounts|username|usernames|user|handle|handles|name)$/i.test(token)) continue;
    // Plausible username charset, must contain at least one letter
    if (!/^[A-Za-z0-9._-]+$/.test(token)) continue;
    if (!/[A-Za-z]/.test(token)) continue;
    if (!accounts.includes(token)) accounts.push(token);
    if (accounts.length >= MAX_ATTACH_ACCOUNTS) break;
  }
  return accounts;
}

function joinTranscript(base: string, chunk: string): string {
  return [base.trim(), chunk.trim()].filter(Boolean).join(" ");
}

// Micro-motion keyframes (scoped names; disabled under prefers-reduced-motion)
const agentPanelStyles = `
@keyframes agent-panel-in {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes agent-fab-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes agent-msg-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes agent-mic-pulse {
  0% { box-shadow: 0 0 0 0 rgba(225, 29, 72, 0.4); }
  70% { box-shadow: 0 0 0 7px rgba(225, 29, 72, 0); }
  100% { box-shadow: 0 0 0 0 rgba(225, 29, 72, 0); }
}
.agent-panel-enter { animation: agent-panel-in 0.28s cubic-bezier(0.32, 0.72, 0.35, 1) both; }
.agent-fab-enter { animation: agent-fab-in 0.2s ease-out both; }
.agent-msg-enter { animation: agent-msg-in 0.22s ease-out both; }
.agent-mic-pulse { animation: agent-mic-pulse 1.6s ease-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .agent-panel-enter, .agent-fab-enter, .agent-msg-enter, .agent-mic-pulse {
    animation: none !important;
  }
}
`;

// ─── Component ─────────────────────────────────────────

export default function AgentPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [attachedAccounts, setAttachedAccounts] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptBaseRef = useRef("");

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Feature-detect speech recognition after mount (avoids hydration mismatch)
  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  // Clean up recognition on unmount
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        rec.onresult = null;
        rec.onend = null;
        rec.onerror = null;
        rec.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  // ── Voice Input ──

  const stopListening = () => {
    const rec = recognitionRef.current;
    if (rec) {
      rec.stop(); // onend fires and clears state
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";

    transcriptBaseRef.current = input;

    rec.onresult = (event) => {
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalChunk += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (finalChunk) {
        transcriptBaseRef.current = joinTranscript(transcriptBaseRef.current, finalChunk);
      }
      // Interim transcript streams live into the input; user reviews & sends manually
      setInput(joinTranscript(transcriptBaseRef.current, interim));
    };
    rec.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    setIsListening(true);
    try {
      rec.start();
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
    }
  };

  // ── CSV Attach ──

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    try {
      const text = await file.text();
      const accounts = parseAccountsFromText(text);
      if (accounts.length === 0) {
        toast.info("No account names found in that file.");
        return;
      }
      setAttachedAccounts(accounts);
      inputRef.current?.focus();
    } catch {
      toast.error("Couldn't read that file.");
    }
  };

  const clearAttachments = () => setAttachedAccounts([]);

  // ── Panel open/close ──

  const closePanel = () => {
    stopListening();
    setIsOpen(false);
  };

  // ── Send Message ──

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    stopListening();

    let text = input.trim();
    if (attachedAccounts.length > 0) {
      text = `${text}\n\nAccounts: ${attachedAccounts.join(", ")}`;
    }

    const userMessage: Message = {
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setAttachedAccounts([]);
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

  const statusLabel = isListening ? "Listening…" : loading ? "Thinking…" : "Online";

  if (!isOpen) {
    return (
      <>
        <style>{agentPanelStyles}</style>
        <button
          onClick={() => setIsOpen(true)}
          className="agent-fab-enter fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-zinc-900 border border-[#27272a] text-zinc-100 shadow-lg shadow-black/40 flex items-center justify-center transition-transform duration-200 ease-out hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
          title="Open Sleeck Agent"
          aria-label="Open Sleeck Agent"
        >
          <Sparkles className="w-6 h-6" />
        </button>
      </>
    );
  }

  return (
    <>
      <style>{agentPanelStyles}</style>
      <div
        className="agent-panel-enter fixed z-50 flex flex-col overflow-hidden border border-[#27272a] bg-zinc-950 shadow-2xl shadow-black/50
          inset-x-0 bottom-0 h-[92dvh] rounded-t-3xl
          sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[420px] sm:max-w-[calc(100vw-3rem)] sm:h-[min(640px,calc(100dvh-3rem))] sm:rounded-3xl"
        role="dialog"
        aria-label="Sleeck Agent"
      >
        {/* Grabber pill */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-9 h-1 rounded-full bg-zinc-700/80" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-[#27272a]">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: `${ACCENT}1A` }}
            >
              <Sparkles className="w-4 h-4" style={{ color: ACCENT }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">Sleeck Agent</h3>
              <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isListening ? "bg-[#E11D48] animate-pulse" : "bg-emerald-500"
                  }`}
                />
                {statusLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setShowAudit(!showAudit);
                if (!showAudit) fetchAudit();
              }}
              className={`p-2 rounded-full transition ${
                showAudit
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
              }`}
              title="Audit Log"
              aria-label="Audit Log"
            >
              <Clock className="w-4 h-4" />
            </button>
            <button
              onClick={closePanel}
              className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 rounded-full transition"
              title="Close"
              aria-label="Close"
            >
              <ChevronDown className="w-4 h-4" />
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
                  className="border border-[#27272a] rounded-xl p-2.5 bg-zinc-900/60 space-y-1"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-zinc-200 font-mono">
                      {entry.toolName}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase border ${
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
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: `${ACCENT}1A` }}
                  >
                    <Sparkles className="w-6 h-6" style={{ color: ACCENT }} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-zinc-200">What can I help with?</p>
                    <p className="text-[11px] text-zinc-500 max-w-[280px] leading-relaxed">
                      Manage accounts, posting schedules, render queues, and more — all via natural
                      language.
                    </p>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className="agent-msg-enter space-y-2">
                  {/* Message Bubble */}
                  <div
                    className={`flex gap-2 ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {msg.role === "assistant" && (
                      <div className="w-6 h-6 rounded-full bg-zinc-900 border border-[#27272a] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Bot className="w-3 h-3 text-zinc-400" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] px-3.5 py-2 text-[13px] leading-relaxed ${
                        msg.role === "user"
                          ? "bg-[#E11D48] text-white rounded-2xl rounded-br-md"
                          : "bg-zinc-900 border border-[#27272a] text-zinc-200 rounded-2xl rounded-bl-md"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
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
                <div className="agent-msg-enter flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-zinc-900 border border-[#27272a] flex items-center justify-center flex-shrink-0">
                    <Bot className="w-3 h-3 text-zinc-400" />
                  </div>
                  <div className="bg-zinc-900 border border-[#27272a] rounded-2xl rounded-bl-md px-3.5 py-3">
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
              className="border-t border-[#27272a] px-3 pt-2.5 pb-3 bg-zinc-950"
            >
              {/* Suggestion chips (empty chat only) */}
              {messages.length === 0 && (
                <div className="flex flex-wrap gap-1.5 pb-2.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        setInput(suggestion);
                        setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                      className="px-2.5 py-1 text-[10px] font-medium bg-zinc-900 border border-[#27272a] text-zinc-400 rounded-full hover:text-white hover:border-zinc-600 transition"
                    >
                      {suggestion}
                    </button>
                  ))}
                  {!speechSupported && (
                    <p className="w-full text-[10px] text-zinc-600 pt-0.5">
                      Voice input isn&apos;t supported in this browser
                    </p>
                  )}
                </div>
              )}

              {/* Attached accounts preview */}
              {attachedAccounts.length > 0 && (
                <div className="flex items-center gap-2 pb-2">
                  <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-zinc-900 border border-[#27272a] text-[11px] text-zinc-300">
                    <Paperclip className="w-3 h-3 text-zinc-500" />
                    {attachedAccounts.length} account{attachedAccounts.length === 1 ? "" : "s"} attached
                    <button
                      type="button"
                      onClick={clearAttachments}
                      className="p-0.5 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition"
                      title="Clear attached accounts"
                      aria-label="Clear attached accounts"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                  <span className="text-[10px] text-zinc-600 truncate">
                    {attachedAccounts.slice(0, 3).join(", ")}
                    {attachedAccounts.length > 3 ? "…" : ""}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2">
                {/* iOS-style input pill */}
                <div
                  className={`flex-1 flex items-center gap-1 bg-zinc-900 border rounded-full pl-1 pr-1 py-1 transition ${
                    isListening ? "border-[#E11D48]/50" : "border-[#27272a] focus-within:border-zinc-600"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileChange}
                    className="hidden"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition flex-shrink-0"
                    title="Attach accounts (.csv, .txt)"
                    aria-label="Attach accounts file"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder={isListening ? "Listening…" : "Ask anything…"}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={loading}
                    className="flex-1 min-w-0 bg-transparent text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
                  />
                  {speechSupported && (
                    <button
                      type="button"
                      onClick={toggleListening}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition flex-shrink-0 ${
                        isListening
                          ? "text-[#E11D48] agent-mic-pulse"
                          : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                      }`}
                      title={isListening ? "Stop listening" : "Voice input"}
                      aria-label={isListening ? "Stop listening" : "Voice input"}
                      aria-pressed={isListening}
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Send button */}
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="w-9 h-9 rounded-full bg-[#E11D48] text-white flex items-center justify-center flex-shrink-0 transition-all hover:bg-[#be123c] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed motion-reduce:transition-none motion-reduce:active:scale-100"
                  title="Send"
                  aria-label="Send message"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </>
  );
}

// ─── Sub-Components ────────────────────────────────────

function ToolCallCard({ toolCall }: { toolCall: ToolCallResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`border rounded-xl text-[10px] overflow-hidden ${
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
            <pre className="text-[9px] text-zinc-400 bg-zinc-950 p-1.5 rounded-lg mt-0.5 overflow-x-auto max-h-20 overflow-y-auto">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          <div>
            <span className="text-[8px] text-zinc-500 uppercase font-bold">Output</span>
            <pre className="text-[9px] text-zinc-400 bg-zinc-950 p-1.5 rounded-lg mt-0.5 overflow-x-auto max-h-20 overflow-y-auto">
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
    <div className="border border-amber-900/40 bg-amber-950/10 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
          Confirmation Required
        </span>
      </div>

      <div className="text-[10px] text-zinc-300 space-y-1">
        <div className="font-mono font-bold text-zinc-200">{confirmation.toolName}</div>
        <pre className="text-[9px] text-zinc-400 bg-zinc-950 border border-zinc-800/50 p-2 rounded-lg overflow-x-auto max-h-24 overflow-y-auto">
          {JSON.stringify(confirmation.input, null, 2)}
        </pre>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(confirmation.id, true)}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-emerald-600 text-white rounded-full text-[10px] font-bold hover:bg-emerald-500 transition disabled:opacity-40"
        >
          <CheckCircle className="w-3 h-3" />
          Approve
        </button>
        <button
          onClick={() => onConfirm(confirmation.id, false)}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-full text-[10px] font-bold hover:bg-zinc-700 transition disabled:opacity-40"
        >
          <XCircle className="w-3 h-3" />
          Deny
        </button>
      </div>
    </div>
  );
}
