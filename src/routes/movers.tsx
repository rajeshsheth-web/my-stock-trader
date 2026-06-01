import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/movers")({
  component: MoversPage,
});

function MoversPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <h1 className="text-3xl font-bold" style={{ color: "var(--color-fg)" }}>
        Top Movers
      </h1>
      <p className="text-lg" style={{ color: "var(--color-muted)" }}>
        Coming soon — gainers, losers, and most active by volume.
      </p>
    </div>
  );
}
