"use client"

import { useMemo, useRef, useState, type ChangeEvent } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  FileDownIcon,
  FileUpIcon,
  LandmarkIcon,
  ScaleIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { BOND_QUOTE_BASIS, type Bond } from "@/lib/bonds"
import { type Cedear, formatArs } from "@/lib/cedears"
import { logoUrl } from "@/lib/logo"
import { readPortfolioHoldings } from "@/lib/portfolio"
import {
  computeAccumulation,
  computeRebalance,
  donutColor,
  formatPercent,
  parsePortfolioCsv,
  portfolioToCsv,
  type RebalanceInput,
} from "@/lib/tools"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CedearPicker } from "@/components/cedear-picker"
import { PortfolioDonut, type DonutSegment } from "@/components/portfolio-donut"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

type RowState = {
  ticker: string
  quantity: number
  targetPct: number
}

type Mode = "rebalance" | "accumulate"

type Asset = {
  ticker: string
  name: string
  /** Ticker para el logo; null en bonos. */
  logoTicker: string | null
  /** Precio en ARS por 1 nominal (los bonos cotizan cada 100). */
  unitPrice: number | null
  isBond: boolean
}

const MODES: { value: Mode; label: string; description: string }[] = [
  {
    value: "rebalance",
    label: "Compra y venta",
    description: "Vendé lo que sobra y comprá lo que falta, sin aportar dinero.",
  },
  {
    value: "accumulate",
    label: "Solo compra (acumulación)",
    description: "Invertí dinero nuevo en lo que está por debajo del objetivo, sin vender.",
  },
]

const numericCell = "text-right font-mono tabular-nums"

export function RebalanceCalculator({
  cedears,
  bonds = [],
}: {
  cedears: Cedear[]
  bonds?: Bond[]
}) {
  const [rows, setRows] = useState<RowState[]>([])
  const [mode, setMode] = useState<Mode>("rebalance")
  const [contribution, setContribution] = useState<number>(100000)

  const assetByTicker = useMemo(() => {
    const assets = new Map<string, Asset>()
    for (const b of bonds) {
      assets.set(b.symbol, {
        ticker: b.symbol,
        name: b.name,
        logoTicker: null,
        unitPrice: b.price / BOND_QUOTE_BASIS,
        isBond: true,
      })
    }
    // Ante un ticker repetido, gana el CEDEAR.
    for (const c of cedears) {
      assets.set(c.Cedears, {
        ticker: c.Cedears,
        name: c.Name,
        logoTicker: c.TickerOriginal,
        unitPrice: c.price,
        isBond: false,
      })
    }
    return assets
  }, [cedears, bonds])

  const selectedSet = useMemo(
    () => new Set(rows.map((r) => r.ticker)),
    [rows],
  )

  const rawByTicker = useMemo(
    () => new Map(rows.map((r) => [r.ticker, r])),
    [rows],
  )

  function addTicker(ticker: string) {
    setRows((current) =>
      current.some((r) => r.ticker === ticker)
        ? current
        : [...current, { ticker, quantity: 0, targetPct: 0 }],
    )
  }

  function removeTicker(ticker: string) {
    setRows((current) => current.filter((r) => r.ticker !== ticker))
  }

  function updateRow(ticker: string, patch: Partial<RowState>) {
    setRows((current) =>
      current.map((r) => (r.ticker === ticker ? { ...r, ...patch } : r)),
    )
  }

  function importFromPortfolio() {
    const holdings = readPortfolioHoldings()
    const entries = Object.entries(holdings).filter(([ticker]) =>
      assetByTicker.has(ticker),
    )
    if (entries.length === 0) return
    setRows(
      entries.map(([ticker, quantity]) => ({
        ticker,
        quantity,
        targetPct: 0,
      })),
    )
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  function exportCsv() {
    const blob = new Blob([portfolioToCsv(rows)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `cartera-rebalanceo-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success("Cartera exportada", {
      description: `${rows.length} activos. Podés volver a importarla con "Importar CSV".`,
    })
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    const entries = parsePortfolioCsv(await file.text())
    const known = entries.filter((e) => assetByTicker.has(e.ticker))
    const unknown = entries.filter((e) => !assetByTicker.has(e.ticker))

    if (known.length === 0) {
      toast.error("No se pudo importar el archivo", {
        description:
          "No encontramos CEDEARs ni bonos válidos. El formato esperado es: ticker,nominales,objetivo_pct",
      })
      return
    }

    setRows(known)
    toast.success("Cartera importada", {
      description:
        unknown.length > 0
          ? `${known.length} activos. Se omitieron tickers desconocidos: ${unknown.map((e) => e.ticker).join(", ")}.`
          : `${known.length} activos.`,
    })
  }

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".csv,text/csv,text/plain"
      className="hidden"
      onChange={importCsv}
    />
  )

  function distributeEqually() {
    setRows((current) => {
      if (current.length === 0) return current
      const even = Math.round((100 / current.length) * 10) / 10
      return current.map((r) => ({ ...r, targetPct: even }))
    })
  }

  const inputs: RebalanceInput[] = useMemo(
    () =>
      rows
        .map((r): RebalanceInput | null => {
          const asset = assetByTicker.get(r.ticker)
          if (!asset) return null
          return {
            cedear: {
              Cedears: asset.ticker,
              Name: asset.name,
              TickerOriginal: asset.logoTicker ?? "",
              price: asset.unitPrice,
            },
            quantity: r.quantity,
            targetPct: r.targetPct,
          }
        })
        .filter((v): v is RebalanceInput => v !== null),
    [rows, assetByTicker],
  )

  const accumulation = useMemo(
    () => (mode === "accumulate" ? computeAccumulation(inputs, contribution) : null),
    [mode, inputs, contribution],
  )
  const rebalance = useMemo(
    () => (mode === "rebalance" ? computeRebalance(inputs) : null),
    [mode, inputs],
  )
  const result = accumulation ?? rebalance!

  const currentSegments: DonutSegment[] = useMemo(
    () =>
      result.rows
        .map((row, index) => ({
          key: row.ticker,
          label: row.ticker,
          value: row.currentValue,
          color: donutColor(index),
        }))
        .filter((s) => s.value > 0),
    [result.rows],
  )

  const targetSegments: DonutSegment[] = useMemo(
    () =>
      result.rows
        .map((row, index) => ({
          key: row.ticker,
          label: row.ticker,
          // En acumulación el objetivo puede no alcanzarse: mostramos cómo
          // queda la cartera después de la compra.
          value: mode === "accumulate" ? row.newValue : row.targetValue,
          color: donutColor(index),
        }))
        .filter((s) => s.value > 0),
    [result.rows, mode],
  )

  const operations = useMemo(
    () => result.rows.filter((row) => row.deltaNominales !== 0),
    [result.rows],
  )

  const targetSumOk = Math.abs(result.targetSum - 100) < 0.5

  // El buscador se renderiza siempre en la misma posición del árbol para que
  // no se remonte (y pierda el foco) al agregar el primer CEDEAR.
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CedearPicker
          cedears={cedears}
          bonds={bonds}
          selected={selectedSet}
          onAdd={addTicker}
        />
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={importFromPortfolio}>
              <DownloadIcon className="size-4" />
              Importar Portfolio
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUpIcon className="size-4" />
              Importar CSV
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
              <FileDownIcon className="size-4" />
              Exportar CSV
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={distributeEqually}>
              Distribuir 100% en partes iguales
            </Button>
          </div>
        )}
      </div>
      {fileInput}

      {rows.length === 0 ? (
        <Empty className="rounded-lg border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScaleIcon />
            </EmptyMedia>
            <EmptyTitle>Armá tu cartera</EmptyTitle>
            <EmptyDescription>
              Agregá CEDEARs o bonos y cargá cuántos nominales tenés de cada uno para ver
              la composición actual y calcular el rebalanceo.
            </EmptyDescription>
          </EmptyHeader>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" onClick={importFromPortfolio}>
              <DownloadIcon className="size-4" />
              Importar desde mi Portfolio
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUpIcon className="size-4" />
              Importar CSV
            </Button>
          </div>
        </Empty>
      ) : (
        <>
        {/* Modo de cálculo */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">¿Cómo querés rebalancear?</h2>
          <div
            role="radiogroup"
            aria-label="Modo de rebalanceo"
            className="grid gap-2 sm:grid-cols-2"
          >
            {MODES.map((option) => {
              const selected = mode === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(option.value)}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border bg-card p-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected && "border-foreground ring-1 ring-foreground",
                  )}
                >
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              )
            })}
          </div>

          {mode === "accumulate" && (
            <div className="flex flex-col gap-2">
              <label htmlFor="rebalance-contribution" className="text-sm font-medium">
                ¿Cuánto querés invertir?
              </label>
              <div className="relative w-full sm:max-w-xs">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted-foreground">
                  $
                </span>
                <Input
                  id="rebalance-contribution"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={contribution > 0 ? contribution : ""}
                  onChange={(e) =>
                    setContribution(e.target.value === "" ? 0 : Number(e.target.value))
                  }
                  className="pl-7 font-mono"
                  aria-label="Monto a invertir en ARS"
                />
              </div>
              {accumulation?.requiredContribution != null &&
                accumulation.requiredContribution >= 1 && (
                  <p className="text-sm text-muted-foreground">
                    Para llegar exactamente al objetivo sin vender necesitás aportar{" "}
                    <span className="font-mono font-medium text-foreground">
                      {formatArs(accumulation.requiredContribution)}
                    </span>
                    .{" "}
                    <button
                      type="button"
                      className="underline underline-offset-4 hover:text-foreground"
                      onClick={() =>
                        setContribution(Math.ceil(accumulation.requiredContribution ?? 0))
                      }
                    >
                      Usar este monto
                    </button>
                  </p>
                )}
            </div>
          )}
        </section>

        {/* Composición */}
        <section className="grid gap-6 rounded-lg border bg-card p-4 sm:grid-cols-2">
          <figure className="flex flex-col items-center gap-3">
            <figcaption className="text-sm font-medium text-muted-foreground">
              Composición actual
            </figcaption>
            <PortfolioDonut
              segments={currentSegments}
              centerLabel="Total"
              centerValue={formatArs(result.totalValue)}
              ariaLabel="Composición actual del portfolio"
              emptyMessage="Cargá nominales para ver tu composición actual."
            />
          </figure>
          <figure className="flex flex-col items-center gap-3">
            <figcaption className="text-sm font-medium text-muted-foreground">
              {accumulation ? "Composición después de comprar" : "Composición objetivo"}
            </figcaption>
            {accumulation ? (
              <PortfolioDonut
                segments={targetSegments}
                centerLabel="Total"
                centerValue={formatArs(accumulation.totalValue + accumulation.invested)}
                ariaLabel="Composición del portfolio después de la compra"
                emptyMessage="Definí porcentajes objetivo y un monto a invertir."
              />
            ) : (
              <PortfolioDonut
                segments={targetSegments}
                centerLabel="Objetivo"
                centerValue={targetSumOk ? "100%" : formatPercent(result.targetSum)}
                ariaLabel="Composición objetivo del portfolio"
                emptyMessage="Definí porcentajes objetivo para ver tu meta."
              />
            )}
          </figure>
        </section>

        {/* Tabla de entradas */}
        <div className="overflow-hidden rounded-lg border">
          <Table className="min-w-[48rem]">
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="min-w-24">Ticker</TableHead>
                <TableHead className="min-w-24 text-right">Precio</TableHead>
                <TableHead className="min-w-28 text-right">Nominales</TableHead>
                <TableHead className="min-w-24 text-right">Valor</TableHead>
                <TableHead className="min-w-20 text-right">% actual</TableHead>
                <TableHead className="min-w-28 text-right">% objetivo</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => {
                const raw = rawByTicker.get(row.ticker)
                const isBond = assetByTicker.get(row.ticker)?.isBond ?? false
                return (
                <TableRow key={row.ticker} className="bg-card hover:bg-muted/50">
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      {isBond ? (
                        <LandmarkIcon
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      ) : (
                        <img
                          src={logoUrl(row.tickerOriginal) || "/placeholder.svg"}
                          alt=""
                          width={16}
                          height={16}
                          className="size-4 shrink-0 rounded-sm bg-muted object-contain"
                          loading="lazy"
                        />
                      )}
                      <span className="font-mono font-medium">{row.ticker}</span>
                    </span>
                    {isBond && (
                      <span className="block text-xs text-muted-foreground">{row.name}</span>
                    )}
                  </TableCell>
                  <TableCell className={numericCell}>
                    {isBond && row.price !== null ? (
                      <>
                        {formatArs(row.price * BOND_QUOTE_BASIS)}
                        <span className="block text-xs text-muted-foreground">
                          c/100 VN
                        </span>
                      </>
                    ) : (
                      formatArs(row.price)
                    )}
                  </TableCell>
                  <TableCell className={numericCell}>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step="any"
                      value={raw && raw.quantity > 0 ? raw.quantity : ""}
                      onChange={(e) =>
                        updateRow(row.ticker, {
                          quantity: e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                      className="ml-auto w-24 text-right font-mono"
                      aria-label={`Nominales de ${row.ticker}`}
                    />
                  </TableCell>
                  <TableCell className={numericCell}>{formatArs(row.currentValue)}</TableCell>
                  <TableCell className={numericCell}>{formatPercent(row.currentPct)}</TableCell>
                  <TableCell className={numericCell}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="any"
                      value={raw && raw.targetPct > 0 ? raw.targetPct : ""}
                      onChange={(e) =>
                        updateRow(row.ticker, {
                          targetPct: e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                      className="ml-auto w-20 text-right font-mono"
                      aria-label={`Porcentaje objetivo de ${row.ticker}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      onClick={() => removeTicker(row.ticker)}
                      aria-label={`Quitar ${row.ticker}`}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        <p
          className={cn(
            "text-sm",
            targetSumOk ? "text-muted-foreground" : "text-destructive",
          )}
        >
          Suma de objetivos: {formatPercent(result.targetSum)}.{" "}
          {targetSumOk
            ? "Distribución completa."
            : "Se normaliza automáticamente al 100% para el cálculo."}
        </p>

        {/* Operaciones */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Operaciones sugeridas</h2>
          {operations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {accumulation
                ? "Con este monto no alcanza para comprar ningún nominal (o falta definir porcentajes objetivo)."
                : "Tu cartera ya está balanceada según el objetivo (o falta definir porcentajes y nominales)."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table className="min-w-[40rem]">
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="min-w-28">Operación</TableHead>
                    <TableHead className="min-w-24">Ticker</TableHead>
                    <TableHead className="min-w-28 text-right">Nominales</TableHead>
                    <TableHead className="min-w-28 text-right">Monto aprox.</TableHead>
                    <TableHead className="min-w-28 text-right">Nominales final</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.map((row) => {
                    const isBuy = row.deltaNominales > 0
                    return (
                      <TableRow key={row.ticker} className="bg-card hover:bg-muted/50">
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 font-medium",
                              isBuy
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400",
                            )}
                          >
                            {isBuy ? (
                              <ArrowUpIcon className="size-4" />
                            ) : (
                              <ArrowDownIcon className="size-4" />
                            )}
                            {isBuy ? "Comprar" : "Vender"}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono font-medium">{row.ticker}</TableCell>
                        <TableCell className={numericCell}>
                          {Math.abs(row.deltaNominales)}
                        </TableCell>
                        <TableCell className={numericCell}>
                          {formatArs(
                            row.price !== null
                              ? Math.abs(row.deltaNominales) * row.price
                              : null,
                          )}
                        </TableCell>
                        <TableCell className={numericCell}>{row.newQuantity}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {accumulation && accumulation.invested > 0 && (
            <p className="text-sm text-muted-foreground">
              Total a invertir:{" "}
              <span className="font-mono font-medium text-foreground">
                {formatArs(accumulation.invested)}
              </span>
              .
            </p>
          )}
          {Math.abs(result.residualCash) >= 0.01 && (
            <p className="text-sm text-muted-foreground">
              {accumulation
                ? "Vuelto sin invertir por redondeo a nominales enteros: "
                : "Efectivo remanente por redondeo a nominales enteros: "}
              <span className="font-mono font-medium text-foreground">
                {formatArs(result.residualCash)}
              </span>
              .
            </p>
          )}
          {result.hasMissingPrices && (
            <p className="text-sm text-destructive">
              Algunos activos no tienen precio disponible y se excluyen del cálculo.
            </p>
          )}
        </section>
        </>
      )}
    </div>
  )
}
