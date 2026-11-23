import { useEffect, useState } from 'react'

// The value, once it has stopped changing for `ms`. Compared by JSON, so a new
// object with the same contents doesn't restart the wait.
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  const key = JSON.stringify(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
    // key stands in for value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms])
  return settled
}
