// Telegram rejects messages over 4096 chars; we cut earlier to leave
// headroom for HTML entities added after chunking.
export const CHUNK_LIMIT = 4000

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

// Splits long text preferring paragraph breaks, then line breaks, then
// spaces, then a hard cut for pathological single-word runs.
export function chunkText(text: string, limit: number = CHUNK_LIMIT): string[] {
  if (text.length === 0) return []
  if (text.length <= limit) return [text]

  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let consumed = limit
    let taken = window
    for (const separator of ['\n\n', '\n', ' ']) {
      const at = window.lastIndexOf(separator)
      if (at > 0) {
        taken = window.slice(0, at)
        consumed = at + separator.length
        break
      }
    }
    chunks.push(taken)
    rest = rest.slice(consumed)
  }
  if (rest.length > 0) chunks.push(rest)
  return chunks
}
