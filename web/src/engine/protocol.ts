import type { Progress } from './boot.ts'
import type { BookArgs, BookReport, ExploreArgs, ExploreResult } from './types.ts'

export type ToWorker = { type: 'explore'; id: number; args: ExploreArgs } | { type: 'book'; id: number; args: BookArgs }

export type FromWorker =
  | { type: 'progress'; progress: Progress }
  | { type: 'ready'; pyodide: string; packages: string[]; bootMs: number }
  | { type: 'bookProgress'; progress: Progress }
  | { type: 'bookReady'; packages: string[]; bytes: number; ms: number }
  | { type: 'result'; id: number; args: ExploreArgs; result: ExploreResult; ms: number }
  | { type: 'bookResult'; id: number; args: BookArgs; result: BookReport; ms: number }
  | { type: 'error'; lane: 'boot' | 'bookLoad' | 'explore' | 'book'; id: number | null; message: string }
