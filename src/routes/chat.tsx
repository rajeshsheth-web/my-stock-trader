import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
}

const ASSISTANT_PLACEHOLDER =
  "AI analyst coming in M6. Ask me anything about stocks!";

const SYSTEM_MESSAGE =
  "Bloomberg Desk AI — real-time equity research, earnings analysis, macro commentary, and portfolio risk assessment. Powered by MyStockTrader Intelligence.";

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/chat")({
  component: ChatPage,
});

// ─── Components ───────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mr-2 mt-0.5"
          style={{ background: "var(--color-primary)", color: "#fff" }}
        >
          AI
        </div>
      )}
      <div
        className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
        style={
          isUser
            ? {
                background: "var(--color-primary)",
                color: "#fff",
                borderBottomRightRadius: "4px",
              }
            : {
                background: "var(--color-surface)",
                color: "var(--color-fg)",
                border: "1px solid var(--color-border)",
                borderBottomLeftRadius: "4px",
              }
        }
      >
        {msg.content}
      </div>
      {isUser && (
        <div
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ml-2 mt-0.5"
          style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
        >
          You
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  const suggestions = [
    "What's the outlook for AAPL?",
    "Compare NVDA vs AMD",
    "Explain P/E ratio",
    "Best sectors for 2025?",
  ];
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-6 py-12 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold"
        style={{ background: "var(--color-primary)", color: "#fff" }}
      >
        AI
      </div>
      <div>
        <h2 className="text-xl font-bold mb-1" style={{ color: "var(--color-fg)" }}>
          Bloomberg Desk AI
        </h2>
        <p className="text-sm max-w-sm" style={{ color: "var(--color-muted)" }}>
          {SYSTEM_MESSAGE}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
        {suggestions.map((s) => (
          <div
            key={s}
            className="card text-xs text-left cursor-default"
            style={{ color: "var(--color-muted)" }}
          >
            "{s}"
          </div>
        ))}
      </div>
      <p className="text-xs" style={{ color: "var(--color-border)" }}>
        Full AI analyst launching in M6
      </p>
    </div>
  );
}

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || typing) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTyping(true);

    // Simulate a short delay then respond with placeholder
    setTimeout(() => {
      const reply: Message = {
        role: "assistant",
        content: ASSISTANT_PLACEHOLDER,
      };
      setMessages((prev) => [...prev, reply]);
      setTyping(false);
    }, 800);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="flex flex-col max-w-2xl mx-auto" style={{ height: "calc(100dvh - 9rem)" }}>
      {/* System badge */}
      <div
        className="flex-shrink-0 mb-3 px-3 py-1.5 rounded-lg text-xs text-center"
        style={{
          background: "var(--color-surface)",
          color: "var(--color-muted)",
          border: "1px solid var(--color-border)",
        }}
      >
        {SYSTEM_MESSAGE}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)
        )}

        {typing && (
          <div className="flex justify-start">
            <div
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mr-2 mt-0.5"
              style={{ background: "var(--color-primary)", color: "#fff" }}
            >
              AI
            </div>
            <div
              className="rounded-2xl px-4 py-3 text-sm"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderBottomLeftRadius: "4px",
              }}
            >
              <div className="flex gap-1 items-center">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{
                      background: "var(--color-muted)",
                      animationDelay: `${i * 0.15}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={sendMessage}
        className="flex-shrink-0 mt-3 flex items-end gap-2 rounded-xl border p-2"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about any stock, sector, or concept…"
          rows={1}
          className="flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none bg-transparent"
          style={{ color: "var(--color-fg)", maxHeight: "120px" }}
        />
        <button
          type="submit"
          disabled={!input.trim() || typing}
          className="btn-primary text-sm px-3 py-2 self-end"
        >
          Send
        </button>
      </form>
    </div>
  );
}
