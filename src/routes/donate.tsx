import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/donate')({
  component: DonatePage,
})

function DonatePage() {
  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-fg)' }}>
        Support Us
      </h1>

      {/* Fundraising Thermometer */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Fundraising Progress
        </h2>
        <iframe
          src="https://karusetu-staging.vercel.app/donate/ac304bc1-44e7-4fb6-a6c3-211986a76ea6?embed=1&widget=thermometer"
          style={{ width: '100%', maxWidth: '480px', height: '160px', border: 0 }}
          title="Fundraising thermometer"
          loading="lazy"
        />
      </section>

      {/* Donation Hub */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Donation Hub
        </h2>
        <iframe
          src="https://karusetu-staging.vercel.app/donate/ac304bc1-44e7-4fb6-a6c3-211986a76ea6?embed=1&widget=hub"
          style={{ width: '100%', maxWidth: '480px', height: '420px', border: 0 }}
          title="Donation hub"
          loading="lazy"
        />
      </section>

      {/* Quick Donate Button */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Quick Donate
        </h2>
        <iframe
          src="https://karusetu-staging.vercel.app/donate/ac304bc1-44e7-4fb6-a6c3-211986a76ea6?embed=1&widget=button"
          style={{ width: '100%', maxWidth: '320px', height: '80px', border: 0 }}
          title="Donate button"
          loading="lazy"
        />
      </section>

      {/* Full Donation Form */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Donation Form
        </h2>
        <iframe
          src="https://karusetu-staging.vercel.app/donate/ac304bc1-44e7-4fb6-a6c3-211986a76ea6?embed=1"
          style={{ width: '100%', maxWidth: '720px', height: '900px', border: 0 }}
          title="Donation form"
          loading="lazy"
        />
      </section>
    </div>
  )
}
