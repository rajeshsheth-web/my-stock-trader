import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuth } from "./__root";

export const Route = createFileRoute("/portfolio")({
  beforeLoad: async ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/auth" });
    }
  },
  component: PortfolioPage,
});

function PortfolioPage() {
  const { session } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <h1 className="text-3xl font-bold" style={{ color: "var(--color-fg)" }}>
        Portfolio
      </h1>
      <p className="text-lg" style={{ color: "var(--color-muted)" }}>
        Signed in as <span className="font-medium">{session?.user.email}</span>
      </p>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Portfolio management coming in M2 — track your short and long buckets.
      </p>
    </div>
  );
}
