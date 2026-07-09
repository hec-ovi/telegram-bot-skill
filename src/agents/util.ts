// One short human-readable hint about what a tool call touches, shared by
// adapters that surface tool activity into the presence layer.
export function summarizeToolInput(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const record = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'description']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value.slice(0, 200)
  }
  return undefined
}
