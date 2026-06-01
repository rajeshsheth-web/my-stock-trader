import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/chat")({
  component: ChatPage,
});

function ChatPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <h1 className="text-3xl font-bold" style={{ color: "var(--color-fg)" }}>
        AI Chat
      </h1>
      <p className="text-lg" style={{ color: "var(--color-muted)" }}>
        Coming soon — ask questions about any stock, get AI-powered analysis.
      </p>
    </div>
  );
}
