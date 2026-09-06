import type { PostView } from "../shared/api";

const CONFIRMED_SIGNAL_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const PREVIEW_SIGNAL_MAX_AGE_MS = 36 * 60 * 60 * 1000;

export function selectCurrentSignal(
  posts: PostView[],
  referenceAt: string | number,
): PostView | null {
  const referenceTime = typeof referenceAt === "number"
    ? referenceAt
    : Date.parse(referenceAt);
  const now = Number.isFinite(referenceTime) ? referenceTime : Date.now();

  const latestSignal = [...posts]
    .filter((item) =>
      item.classification?.level === "confirmed" ||
      item.classification?.level === "preview",
    )
    .sort((left, right) => right.post.createdAt.localeCompare(left.post.createdAt))[0];
  if (!latestSignal) return null;

  const publishedAt = Date.parse(latestSignal.post.createdAt);
  const age = now - publishedAt;
  const maxAge = latestSignal.classification?.level === "confirmed"
    ? CONFIRMED_SIGNAL_MAX_AGE_MS
    : PREVIEW_SIGNAL_MAX_AGE_MS;
  return Number.isFinite(publishedAt) && age >= 0 && age < maxAge
    ? latestSignal
    : null;
}
