import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/events')({
  component: EventsPage,
})

function EventsPage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-fg)' }}>
        Events &amp; Tickets
      </h1>

      <iframe
        src="https://karusetu.com/events/99b81656-3dbf-4424-b85b-44e003cb17b5?embed=1"
        style={{ width: '100%', maxWidth: '720px', height: '760px', border: 0 }}
        title="Events"
        loading="lazy"
      />
    </div>
  )
}
