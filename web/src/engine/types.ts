// Shapes of what scripts/api.py takes and returns. Every number in a result
// comes from Python.

export type InstrumentType =
  | 'european_call'
  | 'european_put'
  | 'american_call'
  | 'american_put'
  | 'future'
  | 'sofr_future'
  | 'convertible'
export type InstrumentKind = 'option' | 'future' | 'rates' | 'convertible'

// What api.make_derivative builds from
export interface Spec {
  id?: number | string
  type: InstrumentType
  underlying?: string
  strike?: number
  expiry_years?: number
  face?: number
  conversion_ratio?: number
}

// The setup market, as decimals
export interface SetupMarket {
  spot?: number
  vol?: number
  div_yield?: number
  rate: number
  credit_spread?: number
}

// The slider state: spot_pct in percent, the rest as decimals and days
export interface SliderState {
  spot_pct?: number
  vol?: number
  days_passed?: number
  rate?: number
  credit_spread?: number
}

export interface ExploreArgs {
  spec: Spec
  base: SetupMarket
  now: SliderState
}

export type Breakdown =
  | { kind: 'option'; payoff: number; time_value: number }
  | { kind: 'future'; spot: number; carry: number }
  | { kind: 'rates'; implied_rate_pct: number }
  | {
      kind: 'convertible'
      conversion_value: number
      bond_floor: number
      larger_floor: 'conversion' | 'bond'
      option: number
    }

export interface LadderBar {
  shift: number
  change: number | null
}

export type Series = (number | null)[]

export interface ExploreResult {
  id: number | string
  kind: InstrumentKind
  inputs: {
    spot: number | null
    vol: number | null
    days_passed: number
    rate: number
    credit_spread: number | null
    time_left_years: number
  }
  price: number
  base_price: number
  change: number
  change_pct: number | null
  breakdown: Breakdown
  x: number[]
  x_current: number
  curves: { now: Series; half: Series | null; fifteen: Series | null; expiry: Series | null }
  at_current: { now: number | null; half: number | null; fifteen: number | null; expiry: number | null }
  time_left: { now: number; half: number | null; fifteen: number | null }
  delta_curve: Series | null
  gamma_curve: Series | null
  greeks: {
    delta: number | null
    gamma: number | null
    theta: number | null
    vega: number | null
    rho: number | null
  }
  theta_path: { days: number[]; values: Series } | null
  vega_ladder: LadderBar[] | null
  rho_ladder: LadderBar[]
}

// ---------------------------------------------------------------- book_report

export type MoveField = 'spots' | 'vols' | 'div_yields' | 'credit_spreads' | 'rate' | 'time'

// shock.py's Move vocabulary
export interface EngineMove {
  field: MoveField
  key: string | null
  amount: number
  kind: 'add' | 'pct'
}

export interface BookArgs {
  market: {
    rate: number
    underlyings: { id: string; name: string; spot: number; vol: number; div_yield: number; credit_spread: number }[]
  }
  positions: { id: string; spec: Spec; quantity: number; multiplier: number }[]
  scenarios: { id: string; moves: EngineMove[] }[]
}

export interface InteractionRow {
  singles: (number | null)[]
  sum: number | null
  joint: number | null
  interaction: number | null
}

export interface BookReport {
  positions: { id: string; price: number | null; size: number; value: number | null; notional: number | null }[]
  book: { value: number | null; gross: number | null }
  scenarios: {
    id: string
    changes: Record<string, number | null>
    total: number | null
    pct_of_size: Record<string, number | null>
    total_pct_of_gross: number | null
  }[]
  interactions: {
    id: string
    moves: string[]
    positions: Record<string, InteractionRow>
    book: InteractionRow
  }[]
}
