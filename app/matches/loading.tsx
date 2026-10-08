import LiveDataLoading from '@/components/LiveDataLoading';

export default function Loading() {
  return (
    <LiveDataLoading
      title="Matches"
      description="Fetching current fixtures and recent match results."
    />
  );
}
