import LiveDataLoading from '@/components/LiveDataLoading';

export default function Loading() {
  return (
    <LiveDataLoading
      title="Virtual Betting"
      description="Fetching current fixtures, odds, and pool totals."
    />
  );
}
