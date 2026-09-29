/** Runs async tasks one after another per key (e.g. read-modify-write of one file); a failure doesn't block later tasks. */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<unknown>>()
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const next = (tails.get(key) ?? Promise.resolve()).then(task, task)
    tails.set(key, next)
    return next
  }
}
