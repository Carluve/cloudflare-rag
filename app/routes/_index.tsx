/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import React, { useState, useEffect, useRef, useCallback } from "react";
import Markdown from "react-markdown";
import { toast, Toaster } from "sonner";
import { stream } from "fetch-event-stream";
import { FileUpload } from "../components/fileUpload";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/ui/drawer";
import {
  exampleFiles,
  MODEL_OPTIONS,
  defaultSystemPrompt,
  type ChatSession,
} from "../lib/exampleFiles";
import {
  IconSend,
  IconSettings,
  IconPlus,
  IconMessageCircle,
  IconTrash,
  IconChevronDown,
  IconBrain,
  IconSearch,
  IconPhoto,
  IconX,
  IconMenu2,
  IconSparkles,
  IconCheck,
  IconFileText,
} from "@tabler/icons-react";
import { cn } from "~/lib/utils";

export const meta = () => {
  return [{ title: "RAG Intelligence - Carlos Luengo" }];
};

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */
function Modal({
  open,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={cn(
          "bg-card border border-border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto animate-fadeIn",
          wide ? "w-full max-w-2xl" : "w-full max-w-md"
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Persist                                                             */
/* ------------------------------------------------------------------ */
function loadChats(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("cl-rag-chats") || "[]");
  } catch { return []; }
}
function saveChats(chats: ChatSession[]) {
  if (typeof window !== "undefined") localStorage.setItem("cl-rag-chats", JSON.stringify(chats));
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */
export default function ChatApp() {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ content: string; role: string; isHidden?: boolean }[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [informativeMessage, setInformativeMessage] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [model, setModel] = useState("llama-3.1-8b-instant");
  const [provider, setProvider] = useState("groq");
  const [waitingTime, setWaitingTime] = useState(0);
  const timerRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [relevantContext, setRelevantContext] = useState<{ text: string }[]>([]);
  const [queries, setQueries] = useState<string[]>([]);
  const [selectedExample, setSelectedExample] = useState<(typeof exampleFiles)[0] | null>(null);

  // UI
  const [showSettings, setShowSettings] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt);
  const [newChatName, setNewChatName] = useState("");
  const [newChatPrompt, setNewChatPrompt] = useState(defaultSystemPrompt);
  const [extractedImages, setExtractedImages] = useState<string[]>([]);
  const [showImages, setShowImages] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Session docs - fetched from backend
  const [sessionDocs, setSessionDocs] = useState<{ id: string; name: string; size: number }[]>([]);

  // Close dropdown on outside click
  useEffect(() => {
    function h(e: MouseEvent) {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node))
        setModelDropdownOpen(false);
    }
    if (modelDropdownOpen) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [modelDropdownOpen]);

  useEffect(() => {
    setSessionId(crypto.randomUUID());
    setChats(loadChats());
  }, []);

  useEffect(() => { if (chats.length > 0) saveChats(chats); }, [chats]);

  // Sync active chat
  useEffect(() => {
    if (activeChatId) {
      setChats((prev) =>
        prev.map((c) => c.id === activeChatId ? { ...c, messages, model, provider, systemPrompt } : c)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Fetch session documents when sessionId changes
  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/documents?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((data: any) => setSessionDocs(data.documents || []))
      .catch(() => setSessionDocs([]));
  }, [sessionId]);

  // Also refresh docs after a file upload completes (detected via fileUpload component)
  const refreshSessionDocs = useCallback(() => {
    if (!sessionId) return;
    fetch(`/api/documents?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((data: any) => setSessionDocs(data.documents || []))
      .catch(() => {});
  }, [sessionId]);

  const activeChat = chats.find((c) => c.id === activeChatId);

  const createNewChat = () => {
    const id = crypto.randomUUID();
    const s: ChatSession = {
      id,
      name: newChatName || `Chat ${chats.length + 1}`,
      systemPrompt: newChatPrompt || defaultSystemPrompt,
      sessionId,
      documentIds: [],
      messages: [],
      model,
      provider,
      createdAt: Date.now(),
    };
    setChats((prev) => [s, ...prev]);
    setActiveChatId(id);
    setMessages([]);
    setSystemPrompt(s.systemPrompt);
    setShowNewChat(false);
    setNewChatName("");
    setNewChatPrompt(defaultSystemPrompt);
  };

  const switchChat = (chatId: string) => {
    const chat = chats.find((c) => c.id === chatId);
    if (chat) {
      setActiveChatId(chatId);
      setMessages(chat.messages);
      setModel(chat.model);
      setProvider(chat.provider);
      setSystemPrompt(chat.systemPrompt);
      setSessionId(chat.sessionId);
      setMobileSidebarOpen(false);
    }
  };

  const deleteChat = (chatId: string) => {
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (activeChatId === chatId) { setActiveChatId(null); setMessages([]); }
  };

  /* ---- Send message ---- */
  const handleSendMessage = async (content: string) => {
    const msg = content.trim();
    if (!msg) return;
    if (!activeChatId) {
      const id = crypto.randomUUID();
      const s: ChatSession = {
        id, name: msg.slice(0, 40) + (msg.length > 40 ? "..." : ""),
        systemPrompt, sessionId, documentIds: [], messages: [], model, provider, createdAt: Date.now(),
      };
      setChats((prev) => [s, ...prev]);
      setActiveChatId(id);
    }
    const newMsg = { content: msg, role: "user" };
    setMessages((prev) => [...prev, newMsg]);
    setInputMessage("");
    setRelevantContext([]);
    const allMessages = [...messages, newMsg];

    const response = await stream("/api/stream", {
      method: "POST",
      headers: { "Content-Type": "text/event-stream" },
      body: JSON.stringify({
        messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
        sessionId, model, provider, systemPrompt,
      }),
    });

    for await (const event of response) {
      try {
        const p = JSON.parse(event?.data?.trim().replace(/^data:\s*/, "") || "");
        const nc = p.response || p.choices?.[0]?.delta?.content || p.delta?.text || "";
        if (nc) {
          setInformativeMessage("");
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && !last.isHidden) {
              if (!last.content.endsWith(nc))
                return [...prev.slice(0, -1), { ...last, content: last.content + nc }];
            } else {
              return [...prev, { content: nc, role: "assistant", isHidden: false }];
            }
            return prev;
          });
        } else if (p.message) {
          setInformativeMessage(p.message);
        } else if (p.error) {
          setInformativeMessage("");
          toast.error(p.error);
        }
        if (p.relevantContext) {
          setRelevantContext(p.relevantContext);
          setMessages((prev) => [...prev, {
            content: "Relevant context:\n" + p.relevantContext.map((c: any) => c.text).join("\n"),
            role: "assistant", isHidden: true,
          }]);
        }
        if (p.queries) setQueries(p.queries);
      } catch { /* non-json */ }
    }
  };

  // Timer
  useEffect(() => {
    if (informativeMessage) {
      const t = Date.now();
      timerRef.current = window.setInterval(() => setWaitingTime((Date.now() - t) / 1000), 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setWaitingTime(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [informativeMessage]);

  // Scroll
  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current && shouldAutoScroll) {
      const el = messagesContainerRef.current;
      el.scrollTop = el.scrollHeight - el.clientHeight;
    }
  }, [shouldAutoScroll]);

  useEffect(() => { const t = setTimeout(scrollToBottom, 100); return () => clearTimeout(t); }, [messages, scrollToBottom]);

  const handleScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      setShouldAutoScroll(scrollHeight - scrollTop - clientHeight < 250);
    }
  };

  const cur = MODEL_OPTIONS.flatMap((p) =>
    p.models.map((m) => ({ ...m, provider: p.provider, providerLabel: p.providerLabel, providerIcon: p.providerIcon }))
  ).find((m) => m.id === model);

  /* ================================================================ */
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Toaster theme="dark" position="top-right" toastOptions={{
        style: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" },
      }} />

      {/* Mobile toggle */}
      <button onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-card border border-border">
        <IconMenu2 className="w-5 h-5" />
      </button>

      {/* ============================================================ */}
      {/* SIDEBAR                                                      */}
      {/* ============================================================ */}
      <aside className={cn(
        "flex flex-col h-full w-72 border-r border-border bg-card/80 transition-transform duration-300",
        "fixed lg:static z-40 inset-y-0 left-0",
        mobileSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        {/* Brand */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-primary/90 flex items-center justify-center">
              <IconSparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <h1 className="text-[13px] font-semibold text-foreground leading-tight">RAG Intelligence</h1>
              <p className="text-[10px] text-muted-foreground leading-tight">Carlos Luengo</p>
            </div>
          </div>
        </div>

        {/* New chat */}
        <div className="px-3 pt-3 pb-1">
          <button onClick={() => setShowNewChat(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors">
            <IconPlus className="w-3.5 h-3.5" /> New Chat
          </button>
        </div>

        {/* Chats */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pt-2 pb-1">Chats</p>
          {chats.map((chat) => (
            <div key={chat.id} onClick={() => switchChat(chat.id)} className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-[13px] transition-colors mb-0.5",
              activeChatId === chat.id ? "bg-accent text-foreground font-medium" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            )}>
              <IconMessageCircle className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
              <span className="truncate flex-1">{chat.name}</span>
              <button onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-destructive/10 rounded transition-opacity">
                <IconTrash className="w-3 h-3 text-destructive/70" />
              </button>
            </div>
          ))}
          {chats.length === 0 && <p className="text-[11px] text-muted-foreground/40 text-center py-6">No chats yet</p>}
        </div>

        {/* Session documents indicator */}
        {sessionDocs.length > 0 && (
          <div className="px-3 py-2 border-t border-border">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Session docs</p>
            {sessionDocs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-1.5 py-0.5">
                <IconFileText className="w-3 h-3 text-primary/70 flex-shrink-0" />
                <span className="text-[11px] text-foreground/80 truncate">{doc.name}</span>
                <span className="text-[9px] text-muted-foreground ml-auto flex-shrink-0">
                  {(doc.size / 1024).toFixed(0)}KB
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Upload */}
        <div className="px-3 py-2 border-t border-border">
          <FileUpload
            onChange={refreshSessionDocs}
            sessionId={sessionId}
            setSessionId={setSessionId}
            setSelectedExample={setSelectedExample}
            onImagesExtracted={(imgs) => setExtractedImages((p) => [...p, ...imgs])}
          />
        </div>

        <div className="px-3 py-2 border-t border-border">
          <p className="text-[9px] text-muted-foreground/30 font-mono truncate">{sessionId}</p>
        </div>
      </aside>

      {mobileSidebarOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />}

      {/* ============================================================ */}
      {/* MAIN                                                         */}
      {/* ============================================================ */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 border-b border-border flex items-center justify-between px-4 lg:px-5 bg-card/60 flex-shrink-0">
          <div className="flex items-center gap-2 ml-10 lg:ml-0">
            {activeChat ? (
              <div>
                <h2 className="text-[13px] font-medium text-foreground leading-tight">{activeChat.name}</h2>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  {activeChat.messages.filter((m) => !m.isHidden).length} messages
                  {sessionDocs.length > 0 && <> &middot; {sessionDocs.length} doc{sessionDocs.length > 1 ? "s" : ""}</>}
                </p>
              </div>
            ) : (
              <div>
                <h2 className="text-[13px] font-medium text-foreground leading-tight">Welcome, Carlos</h2>
                <p className="text-[10px] text-muted-foreground leading-tight">Upload docs &amp; start chatting</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Model selector */}
            <div className="relative" ref={modelDropdownRef}>
              <button onClick={() => setModelDropdownOpen((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border hover:border-muted-foreground/30 transition-colors text-[11px]">
                {cur && <img src={cur.providerIcon} alt="" className="w-3.5 h-3.5 rounded-sm" />}
                <span className="text-foreground font-medium hidden sm:inline">{cur?.name || "Model"}</span>
                <IconChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", modelDropdownOpen && "rotate-180")} />
              </button>
              {modelDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-64 bg-card border border-border rounded-lg shadow-xl z-[60] p-1.5 animate-fadeIn">
                  {MODEL_OPTIONS.map((pg) => (
                    <div key={pg.provider} className="mb-0.5">
                      <div className="flex items-center gap-1.5 px-2 py-1">
                        <img src={pg.providerIcon} alt="" className="w-3.5 h-3.5 rounded-sm" />
                        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{pg.providerLabel}</span>
                      </div>
                      {pg.models.map((m) => (
                        <button key={m.id} onClick={() => { setModel(m.id); setProvider(pg.provider); setModelDropdownOpen(false); }}
                          className={cn("w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] transition-colors",
                            model === m.id ? "bg-primary/10 text-primary" : "hover:bg-accent text-foreground")}>
                          <div className="text-left">
                            <p className="font-medium leading-tight">{m.name}</p>
                            <p className="text-[9px] text-muted-foreground">{m.description}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className={cn("text-[8px] px-1 py-px rounded font-semibold",
                              m.badge === "Fast" && "bg-emerald-500/15 text-emerald-400",
                              m.badge === "Balanced" && "bg-blue-500/15 text-blue-400",
                              m.badge === "Popular" && "bg-amber-500/15 text-amber-400",
                              m.badge === "Premium" && "bg-purple-500/15 text-purple-400")}>{m.badge}</span>
                            {model === m.id && <IconCheck className="w-3 h-3 text-primary" />}
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {extractedImages.length > 0 && (
              <button onClick={() => setShowImages(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:border-muted-foreground/30 text-[11px] transition-colors">
                <IconPhoto className="w-3 h-3" />
                <span className="hidden sm:inline">{extractedImages.length}</span>
              </button>
            )}

            <button onClick={() => setShowSettings(true)}
              className="p-1.5 rounded-md hover:bg-accent transition-colors">
              <IconSettings className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
          {messages.filter((m) => !m.isHidden).length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-4">
              <div className="max-w-md w-full text-center space-y-5">
                <div className="space-y-1.5">
                  <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <IconBrain className="w-7 h-7 text-primary" />
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">RAG Intelligence</h2>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">
                    Upload documents and ask questions.<br />Hybrid vector + full-text search.
                  </p>
                </div>

                {sessionDocs.length > 0 && (
                  <div className="text-left bg-card border border-border rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Loaded documents</p>
                    {sessionDocs.map((d) => (
                      <div key={d.id} className="flex items-center gap-1.5 py-0.5">
                        <IconFileText className="w-3 h-3 text-primary/70" />
                        <span className="text-[12px] text-foreground truncate">{d.name}</span>
                      </div>
                    ))}
                  </div>
                )}

                {selectedExample && (
                  <div className="text-left">
                    <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Try asking about {selectedExample.name}:</p>
                    <div className="grid gap-1.5">
                      {selectedExample.questions.map((q, i) => (
                        <button key={i} onClick={() => handleSendMessage(q)}
                          className="text-left text-[12px] text-foreground bg-card hover:bg-accent border border-border rounded-lg px-3 py-2 transition-colors">
                          <div className="flex items-center gap-1.5">
                            <IconSearch className="w-3 h-3 text-muted-foreground flex-shrink-0" />{q}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto px-4 py-5 space-y-3">
              {messages.filter((m) => !m.isHidden).map((m, i) => (
                <div key={i} className={cn("flex animate-fadeIn", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                    m.role === "user"
                      ? "bg-primary text-white"
                      : "bg-card border border-border text-foreground")}>
                    <Markdown className={cn("prose prose-sm max-w-none",
                      m.role === "user" ? "prose-invert" : "prose-neutral dark:prose-invert")}>
                      {m.content}
                    </Markdown>
                  </div>
                </div>
              ))}

              {informativeMessage && (
                <div className="flex justify-start animate-fadeIn">
                  <div className="bg-card border border-border rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <div>
                      <p className="text-[12px] text-foreground">{informativeMessage}</p>
                      <p className="text-[9px] text-muted-foreground">{waitingTime.toFixed(1)}s</p>
                    </div>
                  </div>
                </div>
              )}

              {relevantContext.length > 0 && (
                <div className="flex justify-start">
                  <Drawer>
                    <DrawerTrigger asChild>
                      <button className="flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80 bg-primary/5 hover:bg-primary/10 px-2.5 py-1.5 rounded-md transition-colors">
                        <IconSearch className="w-3 h-3" />View {relevantContext.length} sources
                      </button>
                    </DrawerTrigger>
                    <DrawerContent className="bg-card border-border">
                      <DrawerHeader>
                        <DrawerTitle className="text-foreground">Search Queries</DrawerTitle>
                        <DrawerDescription><ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                          {queries.map((q, i) => <li key={i}>{q}</li>)}
                        </ol></DrawerDescription>
                        <DrawerTitle className="text-foreground mt-4">Retrieved Context</DrawerTitle>
                        <DrawerDescription><ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2">
                          {relevantContext.map((c, i) => <li key={i} className="leading-relaxed">{c.text}</li>)}
                        </ol></DrawerDescription>
                      </DrawerHeader>
                      <DrawerFooter />
                    </DrawerContent>
                  </Drawer>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border bg-card/60 p-3">
          <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(inputMessage); }} className="max-w-2xl mx-auto">
            <div className="relative">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(inputMessage); } }}
                placeholder={sessionDocs.length > 0 ? `Ask about ${sessionDocs.map(d => d.name).join(", ")}...` : "Upload a document first, then ask questions..."}
                rows={1}
                className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 pr-11 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/40 resize-none transition-all"
                style={{ minHeight: 40, maxHeight: 120 }}
              />
              <button type="submit" disabled={!inputMessage.trim()}
                className={cn("absolute right-1.5 bottom-1.5 p-1.5 rounded-md transition-colors",
                  inputMessage.trim() ? "bg-primary text-white hover:bg-primary/90" : "bg-muted text-muted-foreground")}>
                <IconSend className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[9px] text-muted-foreground/40 text-center mt-1.5">
              RAG Intelligence by Carlos Luengo &mdash; Cloudflare Workers AI
            </p>
          </form>
        </div>
      </main>

      {/* ============================================================ */}
      {/* MODALS                                                       */}
      {/* ============================================================ */}

      <Modal open={showNewChat} onClose={() => setShowNewChat(false)}>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">New Chat</h3>
            <button onClick={() => setShowNewChat(false)} className="p-1 rounded-md hover:bg-accent"><IconX className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Name</label>
              <input type="text" value={newChatName} onChange={(e) => setNewChatName(e.target.value)} placeholder="My research..."
                autoFocus className="mt-1 w-full bg-background border border-border rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">System Prompt</label>
              <textarea value={newChatPrompt} onChange={(e) => setNewChatPrompt(e.target.value)} rows={3}
                className="mt-1 w-full bg-background border border-border rounded-md px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Model</label>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {MODEL_OPTIONS.flatMap((p) => p.models.map((m) => (
                  <button key={m.id} type="button" onClick={() => { setModel(m.id); setProvider(p.provider); }}
                    className={cn("px-2.5 py-1.5 rounded-md text-[11px] border transition-all text-left",
                      model === m.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/30 text-muted-foreground")}>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-muted-foreground/60 text-[9px]">{p.providerLabel}</p>
                  </button>
                )))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowNewChat(false)} className="flex-1 px-3 py-2 rounded-md border border-border text-[13px] hover:bg-accent transition-colors">Cancel</button>
            <button onClick={createNewChat} className="flex-1 px-3 py-2 rounded-md bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors">Create</button>
          </div>
        </div>
      </Modal>

      <Modal open={showSettings} onClose={() => setShowSettings(false)}>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Settings</h3>
            <button onClick={() => setShowSettings(false)} className="p-1 rounded-md hover:bg-accent"><IconX className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">System Prompt</label>
              <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={5}
                className="mt-1 w-full bg-background border border-border rounded-md px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Session ID</label>
              <input type="text" value={sessionId} readOnly className="mt-1 w-full bg-background border border-border rounded-md px-3 py-2 text-[11px] text-muted-foreground font-mono" />
            </div>
          </div>
          <button onClick={() => { setSystemPrompt(defaultSystemPrompt); toast.success("Reset"); }}
            className="text-[11px] text-primary hover:text-primary/80">Reset to default</button>
          <div className="flex pt-1">
            <button onClick={() => setShowSettings(false)} className="flex-1 px-3 py-2 rounded-md bg-primary text-white text-[13px] font-medium hover:bg-primary/90">Done</button>
          </div>
        </div>
      </Modal>

      <Modal open={showImages && extractedImages.length > 0} onClose={() => setShowImages(false)} wide>
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-foreground">Images ({extractedImages.length})</h3>
            <button onClick={() => setShowImages(false)} className="p-1 rounded-md hover:bg-accent"><IconX className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
            {extractedImages.map((img, i) => (
              <div key={i} className="rounded-lg border border-border overflow-hidden bg-background">
                <img src={img} alt={`Image ${i + 1}`} className="w-full h-auto object-contain" />
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
