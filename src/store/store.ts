// Flat-file JSON state with atomic writes (tmp file + rename). Holds the
// user tiers, the one-time owner claim code, chat-to-session mapping and
// the poll offset. No database, on purpose.

import { readFile, rename, writeFile } from 'node:fs/promises'

export type Tier = 'owner' | 'trusted' | 'guest' | 'blocked'
export type UserState = Tier | 'pending'

export interface UserRecord {
  state: UserState
  chatId: number
  name?: string
  addedAt: string
}

export interface StoreData {
  users: Record<string, UserRecord>
  sessions: Record<string, string>
  claimCode?: string
  offset?: number
}

export class FileStore {
  #path: string
  #data: StoreData
  #chain: Promise<void> = Promise.resolve()

  constructor(path: string, data: StoreData) {
    this.#path = path
    this.#data = data
  }

  static async open(path: string): Promise<FileStore> {
    try {
      const raw = await readFile(path, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoreData>
      return new FileStore(path, { users: {}, sessions: {}, ...parsed })
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
      return new FileStore(path, { users: {}, sessions: {} })
    }
  }

  get data(): StoreData {
    return this.#data
  }

  // Mutations are serialized so two updates can never interleave their
  // write + rename pair.
  update(mutate: (data: StoreData) => void): Promise<void> {
    const next = this.#chain.then(async () => {
      mutate(this.#data)
      const tmp = `${this.#path}.tmp`
      await writeFile(tmp, JSON.stringify(this.#data, null, 2))
      await rename(tmp, this.#path)
    })
    this.#chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}
