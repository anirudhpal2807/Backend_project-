export interface PaginationParams {
  limit?: number;
  cursor?: string; // Base64 encoded JSON string
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor<T = Record<string, unknown>>(cursor?: string): T | undefined {
  if (!cursor) return undefined;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

export function paginateResults<T extends Record<string, unknown>>(
  items: T[],
  limit: number,
  cursorKey: keyof T,
): PaginatedResult<T> {
  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;

  let nextCursor: string | undefined = undefined;
  if (hasMore && sliced.length > 0) {
    const lastItem = sliced[sliced.length - 1];
    nextCursor = encodeCursor({ [cursorKey as string]: lastItem[cursorKey] });
  }

  return {
    data: sliced,
    meta: {
      limit,
      hasMore,
      nextCursor,
    },
  };
}
