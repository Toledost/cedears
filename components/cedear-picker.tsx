"use client"

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { SearchIcon } from "lucide-react"

import { type Cedear } from "@/lib/cedears"
import { logoUrl } from "@/lib/logo"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

export function CedearPicker({
  cedears,
  selected,
  onAdd,
  placeholder = "Agregar CEDEAR por ticker o nombre...",
}: {
  cedears: Cedear[]
  selected: Set<string>
  onAdd: (ticker: string) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState("")
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === "") return []
    // Ticker exacto primero, después los que empiezan igual, después el resto,
    // para que Enter agregue la coincidencia más probable.
    const rank = (c: Cedear) => {
      const ticker = c.Cedears.toLowerCase()
      if (ticker === q) return 0
      if (ticker.startsWith(q)) return 1
      return 2
    }
    return cedears
      .filter(
        (c) =>
          !selected.has(c.Cedears) &&
          (c.Cedears.toLowerCase().includes(q) ||
            c.Name.toLowerCase().includes(q)),
      )
      .map((c, index) => ({ c, index, rank: rank(c) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, 8)
      .map(({ c }) => c)
  }, [cedears, query, selected])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  function handleAdd(ticker: string) {
    onAdd(ticker)
    setQuery("")
    setFocused(true)
    // Dejar el foco en el buscador para seguir agregando CEDEARs.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const showResults = focused && results.length > 0
  const optionId = (index: number) => `${listId}-option-${index}`

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setFocused(false)
      return
    }
    if (results.length === 0) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setFocused(true)
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setFocused(true)
      setActiveIndex((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === "Enter" && showResults) {
      e.preventDefault()
      const cedear = results[Math.min(activeIndex, results.length - 1)]
      if (cedear) handleAdd(cedear.Cedears)
    }
  }

  return (
    <div className="relative w-full sm:max-w-md">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showResults}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showResults ? optionId(activeIndex) : undefined}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setFocused(true)
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        className="pl-9"
        aria-label="Buscar CEDEAR para agregar"
      />

      {showResults && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Resultados de búsqueda"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {results.map((cedear, index) => (
            <li
              key={cedear.Cedears}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              data-index={index}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => handleAdd(cedear.Cedears)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                index === activeIndex && "bg-muted",
              )}
            >
              <img
                src={logoUrl(cedear.TickerOriginal) || "/placeholder.svg"}
                alt=""
                width={16}
                height={16}
                className="size-4 shrink-0 rounded-sm bg-muted object-contain"
                loading="lazy"
              />
              <span className="font-mono font-medium">{cedear.Cedears}</span>
              <span className="truncate text-muted-foreground">
                {cedear.Name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
