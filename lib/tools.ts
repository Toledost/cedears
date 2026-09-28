import { type Cedear } from "@/lib/cedears"

const percentFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

const percentSignedFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
})

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—"
  return `${percentFormatter.format(value)}%`
}

export function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—"
  return `${percentSignedFormatter.format(value)} pp`
}

/**
 * Distinct, evenly spread color for donut segments. The site theme is
 * intentionally grayscale, but a composition chart needs separable slices,
 * so we generate harmonious HSL hues by index.
 */
export function donutColor(index: number): string {
  const hue = (index * 57) % 360
  return `hsl(${hue} 52% 55%)`
}

export type SelectedCedear = Pick<
  Cedear,
  "Cedears" | "Name" | "TickerOriginal" | "price"
>

/* ------------------------------------------------------------------ */
/* Rebalanceo                                                          */
/* ------------------------------------------------------------------ */

export type RebalanceInput = {
  cedear: SelectedCedear
  quantity: number
  targetPct: number
}

export type RebalanceRow = {
  ticker: string
  name: string
  tickerOriginal: string
  price: number | null
  quantity: number
  currentValue: number
  currentPct: number
  normalizedTargetPct: number
  targetValue: number
  deltaNominales: number
  newQuantity: number
  newValue: number
  newPct: number
}

export type RebalanceResult = {
  rows: RebalanceRow[]
  totalValue: number
  targetSum: number
  residualCash: number
  hasMissingPrices: boolean
}

export function computeRebalance(inputs: RebalanceInput[]): RebalanceResult {
  const priced = inputs.filter((i) => i.cedear.price !== null)
  const totalValue = priced.reduce(
    (acc, i) => acc + (i.cedear.price ?? 0) * Math.max(i.quantity, 0),
    0,
  )
  const targetSum = inputs.reduce((acc, i) => acc + Math.max(i.targetPct, 0), 0)
  const normFactor = targetSum > 0 ? targetSum : 1

  let allocatedNewValue = 0

  const rows: RebalanceRow[] = inputs.map((input) => {
    const price = input.cedear.price
    const quantity = Math.max(input.quantity, 0)
    const targetPct = Math.max(input.targetPct, 0)
    const currentValue = price !== null ? price * quantity : 0
    const normalizedTargetPct = (targetPct / normFactor) * 100
    const targetValue = totalValue * (targetPct / normFactor)

    let deltaNominales = 0
    let newQuantity = quantity

    if (price !== null && price > 0) {
      deltaNominales = Math.round((targetValue - currentValue) / price)
      newQuantity = Math.max(quantity + deltaNominales, 0)
      deltaNominales = newQuantity - quantity
    }

    const newValue = price !== null ? price * newQuantity : 0
    allocatedNewValue += newValue

    return {
      ticker: input.cedear.Cedears,
      name: input.cedear.Name,
      tickerOriginal: input.cedear.TickerOriginal,
      price,
      quantity,
      currentValue,
      currentPct: totalValue > 0 ? (currentValue / totalValue) * 100 : 0,
      normalizedTargetPct,
      targetValue,
      deltaNominales,
      newQuantity,
      newValue,
      newPct: totalValue > 0 ? (newValue / totalValue) * 100 : 0,
    }
  })

  return {
    rows,
    totalValue,
    targetSum,
    residualCash: totalValue - allocatedNewValue,
    hasMissingPrices: inputs.some((i) => i.cedear.price === null),
  }
}

/* Exportar / importar cartera ------------------------------------- */

export type PortfolioEntry = {
  ticker: string
  quantity: number
  targetPct: number
}

const PORTFOLIO_CSV_HEADER = "ticker,nominales,objetivo_pct"

export function portfolioToCsv(entries: PortfolioEntry[]): string {
  const rows = entries.map((e) => `${e.ticker},${e.quantity},${e.targetPct}`)
  return [PORTFOLIO_CSV_HEADER, ...rows].join("\n") + "\n"
}

/**
 * Lee el CSV exportado. También tolera archivos re-guardados en Excel en
 * español (separador `;` y coma decimal) y la ausencia de encabezado.
 */
export function parsePortfolioCsv(text: string): PortfolioEntry[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
  if (lines.length === 0) return []

  const separator = lines[0].includes(";") ? ";" : ","
  const toNumber = (value: string | undefined) => {
    if (!value) return 0
    let clean = value.replace(/["\s%]/g, "")
    if (separator === ";" && clean.includes(",")) {
      clean = clean.replace(/\./g, "").replace(",", ".")
    }
    const n = Number(clean)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  const byTicker = new Map<string, PortfolioEntry>()
  for (const line of lines) {
    const [rawTicker, rawQuantity, rawTarget] = line.split(separator)
    const ticker = rawTicker?.replace(/"/g, "").trim().toUpperCase()
    if (!ticker || ticker === "TICKER") continue
    byTicker.set(ticker, {
      ticker,
      quantity: toNumber(rawQuantity),
      targetPct: toNumber(rawTarget),
    })
  }
  return [...byTicker.values()]
}

export type AccumulationResult = RebalanceResult & {
  contribution: number
  invested: number
  /** Aporte mínimo para llegar al objetivo sin vender; null si es imposible. */
  requiredContribution: number | null
}

/**
 * Rebalanceo solo con compras: reparte un aporte nuevo entre los CEDEARs
 * que quedan por debajo de su objetivo (calculado sobre cartera + aporte),
 * en proporción a cuánto les falta. Nunca vende.
 */
export function computeAccumulation(
  inputs: RebalanceInput[],
  contribution: number,
): AccumulationResult {
  const safeContribution = Math.max(contribution, 0)
  const totalValue = inputs.reduce(
    (acc, i) => acc + (i.cedear.price ?? 0) * Math.max(i.quantity, 0),
    0,
  )
  const targetSum = inputs.reduce((acc, i) => acc + Math.max(i.targetPct, 0), 0)
  const normFactor = targetSum > 0 ? targetSum : 1
  const newTotal = totalValue + safeContribution

  const base = inputs.map((input) => {
    const price = input.cedear.price
    const quantity = Math.max(input.quantity, 0)
    const weight = Math.max(input.targetPct, 0) / normFactor
    const currentValue = price !== null ? price * quantity : 0
    const targetValue = newTotal * weight
    const buyable = price !== null && price > 0 && weight > 0
    return { input, price, quantity, weight, currentValue, targetValue, buyable }
  })

  const deficits = base.map((b) =>
    b.buyable ? Math.max(b.targetValue - b.currentValue, 0) : 0,
  )
  const deficitSum = deficits.reduce((acc, d) => acc + d, 0)

  const bought = base.map((b, index) => {
    if (!b.buyable || b.price === null) return 0
    const allocation =
      deficitSum > 0
        ? safeContribution * (deficits[index] / deficitSum)
        : safeContribution * b.weight
    return Math.floor(allocation / b.price)
  })

  // El redondeo hacia abajo deja vuelto: lo usamos comprando de a un nominal
  // del CEDEAR que más lejos quede de su objetivo, mientras alcance.
  let leftover =
    safeContribution -
    bought.reduce((acc, n, index) => acc + n * (base[index].price ?? 0), 0)
  for (;;) {
    let best = -1
    let bestGap = 0
    base.forEach((b, index) => {
      if (!b.buyable || b.price === null || b.price > leftover) return
      const gap = b.targetValue - (b.quantity + bought[index]) * b.price
      if (gap > bestGap) {
        best = index
        bestGap = gap
      }
    })
    if (best === -1) break
    bought[best] += 1
    leftover -= base[best].price ?? 0
  }

  const invested = safeContribution - leftover
  const finalTotal = totalValue + invested

  const rows: RebalanceRow[] = base.map((b, index) => {
    const newQuantity = b.quantity + bought[index]
    const newValue = b.price !== null ? b.price * newQuantity : 0
    return {
      ticker: b.input.cedear.Cedears,
      name: b.input.cedear.Name,
      tickerOriginal: b.input.cedear.TickerOriginal,
      price: b.price,
      quantity: b.quantity,
      currentValue: b.currentValue,
      currentPct: totalValue > 0 ? (b.currentValue / totalValue) * 100 : 0,
      normalizedTargetPct: b.weight * 100,
      targetValue: b.targetValue,
      deltaNominales: bought[index],
      newQuantity,
      newValue,
      newPct: finalTotal > 0 ? (newValue / finalTotal) * 100 : 0,
    }
  })

  // Para no vender, el total final tiene que ser al menos current / weight
  // para cada CEDEAR. Si uno con tenencia tiene objetivo 0, es imposible.
  let requiredContribution: number | null = null
  if (targetSum > 0 && totalValue > 0) {
    const impossible = base.some((b) => b.currentValue > 0 && b.weight === 0)
    if (!impossible) {
      const requiredTotal = Math.max(
        ...base.filter((b) => b.weight > 0).map((b) => b.currentValue / b.weight),
      )
      requiredContribution = Math.max(requiredTotal - totalValue, 0)
    }
  }

  return {
    rows,
    totalValue,
    targetSum,
    residualCash: leftover,
    hasMissingPrices: inputs.some((i) => i.cedear.price === null),
    contribution: safeContribution,
    invested,
    requiredContribution,
  }
}

/* ------------------------------------------------------------------ */
/* DCA                                                                 */
/* ------------------------------------------------------------------ */

export type DcaInput = {
  cedear: SelectedCedear
  targetPct: number
}

export type DcaRow = {
  ticker: string
  name: string
  tickerOriginal: string
  price: number | null
  normalizedTargetPct: number
  budget: number
  nominales: number
  invested: number
  actualPct: number
  deviation: number
}

export type DcaResult = {
  rows: DcaRow[]
  amount: number
  totalInvested: number
  leftover: number
  targetSum: number
  hasMissingPrices: boolean
}

export function computeDca(amount: number, inputs: DcaInput[]): DcaResult {
  const safeAmount = Math.max(amount, 0)
  const targetSum = inputs.reduce((acc, i) => acc + Math.max(i.targetPct, 0), 0)
  const normFactor = targetSum > 0 ? targetSum : 1

  const partial = inputs.map((input) => {
    const price = input.cedear.price
    const targetPct = Math.max(input.targetPct, 0)
    const normalizedTargetPct = (targetPct / normFactor) * 100
    const budget = safeAmount * (targetPct / normFactor)
    const nominales =
      price !== null && price > 0 ? Math.floor(budget / price) : 0
    const invested = price !== null ? nominales * price : 0

    return {
      ticker: input.cedear.Cedears,
      name: input.cedear.Name,
      tickerOriginal: input.cedear.TickerOriginal,
      price,
      normalizedTargetPct,
      budget,
      nominales,
      invested,
    }
  })

  const totalInvested = partial.reduce((acc, r) => acc + r.invested, 0)

  const rows: DcaRow[] = partial.map((r) => {
    const actualPct = totalInvested > 0 ? (r.invested / totalInvested) * 100 : 0
    return {
      ...r,
      actualPct,
      deviation: actualPct - r.normalizedTargetPct,
    }
  })

  return {
    rows,
    amount: safeAmount,
    totalInvested,
    leftover: safeAmount - totalInvested,
    targetSum,
    hasMissingPrices: inputs.some((i) => i.cedear.price === null),
  }
}
