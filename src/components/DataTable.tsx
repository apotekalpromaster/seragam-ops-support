import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type RowSelectionState, type SortingState,
} from '@tanstack/react-table'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Inbox, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { exportXlsx } from '../lib/xlsx'
import { Button, EmptyState, ErrorBlock, Input, LoadingBlock } from './ui'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: 'left' | 'right' | 'center'
    /** Nilai untuk export XLSX; default = nilai accessor. */
    exportValue?: (row: TData) => string | number | null | undefined
    /** Judul kolom untuk export bila header berupa elemen. */
    exportHeader?: string
    noExport?: boolean
    className?: string
  }
}

interface Props<T> {
  data: T[] | undefined
  columns: ColumnDef<T, any>[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  /** Kolom yang dicari lewat kotak pencarian (mis. nik, nama). */
  searchKeys?: (keyof T & string)[]
  searchPlaceholder?: string
  toolbar?: ReactNode
  exportName?: string
  onRowClick?: (row: T) => void
  initialSort?: SortingState
  pageSize?: number
  empty?: ReactNode
  selectable?: boolean
  getRowId?: (row: T) => string
  onSelectionChange?: (rows: T[]) => void
  bulkActions?: (rows: T[], clear: () => void) => ReactNode
  rowClassName?: (row: T) => string | undefined
  dense?: boolean
}

export function DataTable<T>({
  data, columns, loading, error, onRetry, searchKeys, searchPlaceholder = 'Cari…', toolbar, exportName,
  onRowClick, initialSort = [], pageSize = 50, empty, selectable, getRowId, onSelectionChange, bulkActions,
  rowClassName, dense,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort)
  const [q, setQ] = useState('')
  const [selection, setSelection] = useState<RowSelectionState>({})
  const searchRef = useRef<HTMLInputElement>(null)

  // "/" memfokuskan pencarian (heuristik #7: pintasan untuk pengguna rutin)
  useEffect(() => {
    if (!searchKeys) return
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [searchKeys])

  const allColumns = useMemo<ColumnDef<T, any>[]>(() => {
    if (!selectable) return columns
    return [{
      id: '_select',
      header: ({ table }) => (
        <input type="checkbox" aria-label="Pilih semua baris" className="size-4 accent-brand-500"
          checked={table.getIsAllRowsSelected()} ref={(el) => { if (el) el.indeterminate = table.getIsSomeRowsSelected() }}
          onChange={table.getToggleAllRowsSelectedHandler()} />
      ),
      cell: ({ row }) => (
        <input type="checkbox" aria-label="Pilih baris" className="size-4 accent-brand-500" checked={row.getIsSelected()}
          onClick={(e) => e.stopPropagation()} onChange={row.getToggleSelectedHandler()} />
      ),
      enableSorting: false,
      meta: { noExport: true, className: 'w-10' },
    }, ...columns]
  }, [columns, selectable])

  const table = useReactTable({
    data: data ?? [],
    columns: allColumns,
    state: { sorting, globalFilter: q, rowSelection: selection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQ,
    onRowSelectionChange: setSelection,
    enableRowSelection: !!selectable,
    getRowId: getRowId ? (r) => getRowId(r) : undefined,
    globalFilterFn: (row, _id, value: string) => {
      if (!value || !searchKeys) return true
      const needle = value.toLowerCase()
      return searchKeys.some((k) => String((row.original as Record<string, unknown>)[k] ?? '').toLowerCase().includes(needle))
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: true,
  })

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original)
  useEffect(() => { onSelectionChange?.(selectedRows) }, [selection]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredCount = table.getFilteredRowModel().rows.length
  const total = data?.length ?? 0

  function doExport() {
    const cols = table.getAllLeafColumns().filter((c) => !c.columnDef.meta?.noExport)
    exportXlsx(`${exportName}-${new Date().toISOString().slice(0, 10)}`, table.getSortedRowModel().rows.map((r) => r.original), cols.map((c) => ({
      header: c.columnDef.meta?.exportHeader ?? (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id),
      value: (row: T) => {
        if (c.columnDef.meta?.exportValue) return c.columnDef.meta.exportValue(row)
        const acc = (c.columnDef as { accessorKey?: string }).accessorKey
        const v = acc ? (row as Record<string, unknown>)[acc] : undefined
        return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : (v as string | number)
      },
    })))
  }

  const pad = dense ? 'px-3 py-2' : 'px-4 py-3'

  return (
    <div>
      {(searchKeys || toolbar || exportName) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {searchKeys && (
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="pl-9 pr-16" aria-label="Pencarian" />
              {q ? (
                <button onClick={() => setQ('')} aria-label="Hapus pencarian" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"><X className="size-4" /></button>
              ) : (
                <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-slate-50 px-1.5 text-[10px] text-slate-400 sm:block">/</kbd>
              )}
            </div>
          )}
          {toolbar}
          <div className="ml-auto flex items-center gap-2">
            {!loading && total > 0 && (
              <span className="text-xs text-muted num">
                {filteredCount === total ? `${total.toLocaleString('id-ID')} baris` : `${filteredCount.toLocaleString('id-ID')} dari ${total.toLocaleString('id-ID')} baris`}
              </span>
            )}
            {exportName && <Button size="sm" icon={<Download className="size-3.5" />} onClick={doExport} disabled={!filteredCount}>Export XLSX</Button>}
          </div>
        </div>
      )}

      {selectable && selectedRows.length > 0 && bulkActions && (
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-200 bg-brand-50 px-4 py-2 text-sm">
          <span className="font-semibold text-brand-800">{selectedRows.length} dipilih</span>
          {bulkActions(selectedRows, () => setSelection({}))}
          <button className="ml-auto text-xs font-semibold text-brand-700 hover:underline" onClick={() => setSelection({})}>Batalkan pilihan</button>
        </div>
      )}

      {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={onRetry} /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const sort = h.column.getIsSorted()
                      const canSort = h.column.getCanSort()
                      const align = h.column.columnDef.meta?.align
                      return (
                        <th key={h.id} scope="col" aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined}
                          className={clsx(pad, 'whitespace-nowrap border-b border-line', align === 'right' && 'text-right', align === 'center' && 'text-center', h.column.columnDef.meta?.className)}>
                          {h.isPlaceholder ? null : canSort ? (
                            <button onClick={h.column.getToggleSortingHandler()} className={clsx('inline-flex items-center gap-1 uppercase hover:text-slate-800', align === 'right' && 'flex-row-reverse')}>
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {sort === 'asc' ? <ArrowUp className="size-3" /> : sort === 'desc' ? <ArrowDown className="size-3" /> : <span className="size-3" />}
                            </button>
                          ) : flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((r) => (
                  <tr key={r.id}
                    onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                    onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r.original) } : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={clsx('border-b border-slate-100 last:border-0', onRowClick && 'cursor-pointer hover:bg-brand-50/40 focus:bg-brand-50/60 focus:outline-none', r.getIsSelected() && 'bg-brand-50/60', rowClassName?.(r.original))}>
                    {r.getVisibleCells().map((c) => {
                      const align = c.column.columnDef.meta?.align
                      return (
                        <td key={c.id} className={clsx(pad, 'align-middle', align === 'right' && 'text-right num whitespace-nowrap', align === 'center' && 'text-center', c.column.columnDef.meta?.className)}>
                          {flexRender(c.column.columnDef.cell, c.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredCount === 0 && (
            q ? (
              <EmptyState icon={<Search className="size-5" />} title={`Tidak ada hasil untuk "${q}"`} action={<Button size="sm" onClick={() => setQ('')}>Hapus pencarian</Button>}>
                Coba kata kunci lain, atau periksa filter yang aktif.
              </EmptyState>
            ) : empty ?? <EmptyState icon={<Inbox className="size-5" />} title="Belum ada data" />
          )}
          {table.getPageCount() > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-xs text-muted">
              <span className="num">Halaman {table.getState().pagination.pageIndex + 1} dari {table.getPageCount()}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Halaman sebelumnya"><ChevronLeft className="size-4" /></Button>
                <Button size="sm" variant="secondary" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Halaman berikutnya"><ChevronRight className="size-4" /></Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
