function SkeletonCard() {
  return <div className="overflow-hidden rounded-[1.35rem] border border-navy-soft bg-navy-surface"><div className="aspect-square bg-navy-soft/80 motion-safe:animate-pulse" /><div className="space-y-3 p-5"><div className="h-3 w-1/3 rounded bg-navy-soft motion-safe:animate-pulse" /><div className="h-5 w-4/5 rounded bg-navy-soft motion-safe:animate-pulse" /><div className="h-4 w-full rounded bg-navy-soft/70 motion-safe:animate-pulse" /><div className="h-8 w-1/2 rounded bg-gold-champagne/15 motion-safe:animate-pulse" /></div></div>;
}

export default function ProductsLoading() {
  return (
    <main className="min-h-screen bg-navy-deep">
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="h-9 w-44 rounded bg-navy-soft motion-safe:animate-pulse" />
        <div className="mt-3 h-4 w-64 rounded bg-navy-soft/70 motion-safe:animate-pulse" />
        <div className="mt-6 h-11 w-full rounded-card bg-navy-soft motion-safe:animate-pulse" />
        <div className="mt-6 h-28 rounded-card border border-navy-soft bg-navy-surface motion-safe:animate-pulse" />
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <SkeletonCard key={index} />)}
        </div>
      </section>
    </main>
  );
}
