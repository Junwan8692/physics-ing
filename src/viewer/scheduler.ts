export interface SchedulerEntry {
  id: string;
  /** 뷰포트 좌표계에서의 컷 중심 y. */
  centerY: number;
  intersecting: boolean;
}

/**
 * 뷰포트 중심에 가까운 순으로 최대 limit개.
 * 거리 동점은 id 사전순으로 갈라 결과를 안정화한다 —
 * 매 프레임 결과가 흔들리면 컷이 깜빡이며 켜졌다 꺼진다.
 */
export function selectActive(
  entries: readonly SchedulerEntry[],
  viewportCenterY: number,
  limit: number,
): string[] {
  if (limit <= 0) return [];
  const distance = (entry: SchedulerEntry): number => {
    const value = Math.abs(entry.centerY - viewportCenterY);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };
  return entries
    .filter((entry) => entry.intersecting)
    .slice()
    .sort((l, r) => {
      // 뺄셈 대신 비교 — 둘 다 Infinity면 차가 NaN이라 정렬이 무너진다.
      const dl = distance(l), dr = distance(r);
      if (dl !== dr) return dl < dr ? -1 : 1;
      return l.id < r.id ? -1 : l.id > r.id ? 1 : 0;
    })
    .slice(0, limit)
    .map((entry) => entry.id);
}
