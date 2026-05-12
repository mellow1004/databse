export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-semibold">Brightvision Master Database</h1>
      <p className="mt-2 text-gray-600">Module 1 — Data Intake &amp; Staging is operational.</p>
      <a href="/admin/health" className="mt-6 text-blue-600 underline">View database health</a>
      <a href="/admin/intake/upload" className="mt-2 text-blue-600 underline">Upload a CSV (Module 1 — Data Intake)</a>
      <a href="/admin/intake/batches" className="mt-2 text-blue-600 underline">View import batches</a>
      <a href="/admin/dedup" className="mt-2 text-blue-600 underline">Review duplicate candidates (Module 2 — Dedup)</a>
      <a href="/admin/conflicts" className="mt-2 text-blue-600 underline">Resolve enrichment conflicts (Module 3)</a>
    </main>
  );
}
