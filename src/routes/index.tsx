import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <h1 className="text-3xl font-bold" style={{ color: "var(--color-fg)" }}>
        Stock Detail
      </h1>
      <p className="text-lg" style={{ color: "var(--color-muted)" }}>
        Coming in M2 — real-time quotes, charts, and fundamentals.
      </p>
    </div>
  );
}
