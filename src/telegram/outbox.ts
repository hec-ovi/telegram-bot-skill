// Serializes outbound Bot API calls so replies, edits and actions leave
// in order and flood-control waits (handled inside TelegramApi.call)
// naturally pace everything queued behind them.

export interface ApiCaller {
  call<T>(method: string, params?: object): Promise<T>
}

export class Outbox {
  #api: ApiCaller
  #tail: Promise<unknown> = Promise.resolve()

  constructor(api: ApiCaller) {
    this.#api = api
  }

  enqueue<T>(method: string, params?: object): Promise<T> {
    const run = this.#tail.then(() => this.#api.call<T>(method, params))
    // A failed call rejects for its caller but never jams the queue.
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
