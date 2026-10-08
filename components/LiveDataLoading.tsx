type LiveDataLoadingProps = {
  title: string;
  description: string;
};

export default function LiveDataLoading({ title, description }: LiveDataLoadingProps) {
  return (
    <main className="container" role="status" aria-live="polite" aria-busy="true">
      <div className="eyebrow">Live WTSL data</div>
      <h1 className="display" style={{ margin: '12px 0 0' }}>{title}</h1>
      <p className="muted" style={{ marginTop: 8 }}>{description}</p>
      <div className="notice" style={{ marginTop: 24 }}>
        Loading the latest official data…
      </div>
    </main>
  );
}
