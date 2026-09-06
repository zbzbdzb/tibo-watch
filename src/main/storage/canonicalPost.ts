import type { MonitoredPost } from '../../shared/domain';

/** Numeric status URLs are shared by RSS GUIDs and browser observations. */
export function canonicalPostId(post: Pick<MonitoredPost, 'id' | 'url'>): string {
  try {
    const url = new URL(post.url);
    return url.pathname.match(/\/status\/(\d+)(?:\/|$)/)?.[1] ?? post.id;
  } catch { return post.id; }
}

function richerText(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  if (left.length !== right.length) return left.length > right.length ? left : right;
  return left < right ? left : right;
}

/** Commutative merge: truncated observations can never erase retained evidence. */
export function mergeCanonicalPost(left: MonitoredPost, right: MonitoredPost = left): MonitoredPost {
  const quotedText = richerText(left.quotedText, right.quotedText);
  const ranks = { original: 0, reply: 1, quote: 2 };
  const kind = quotedText?.trim() ? 'quote' : ranks[left.kind] >= ranks[right.kind] ? left.kind : right.kind;
  const id = canonicalPostId(left);
  const authorHandle = [left.authorHandle, right.authorHandle].sort()[0]!;
  return {
    id, authorHandle, kind, quotedText,
    text: richerText(left.text, right.text) ?? '',
    createdAt: [left.createdAt, right.createdAt].sort()[0]!,
    url: /^\d+$/.test(id) ? `https://x.com/${authorHandle}/status/${id}` : [left.url, right.url].sort()[0]!,
    sourceIds: [...new Set([...left.sourceIds, ...right.sourceIds])].sort(),
  };
}
