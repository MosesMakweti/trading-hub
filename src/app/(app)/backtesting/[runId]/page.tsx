import { redirect } from "next/navigation";

export default async function BacktestRunIndex({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  redirect(`/backtesting/${runId}/session`);
}
