export function kellySize(winRate, avgWin, avgLoss, capital) {
  if (!avgLoss) return capital * 0.05;
  const b = avgWin / avgLoss;
  const kelly = (b * winRate - (1 - winRate)) / b;
  return Math.max(10, Math.min(capital * Math.max(0, kelly) * 0.5, capital * 0.15));
}
