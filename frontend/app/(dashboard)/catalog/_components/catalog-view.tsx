'use client'

import { useState, useMemo } from 'react'
import { Package, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { PageHeader } from '@/components/ui/page-header'
import { Pagination } from '@/components/ui/pagination'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn, formatMoney } from '@/lib/utils'
import type { UserRole } from '@/lib/supabase/dal'
import { CatalogDialog } from './catalog-dialog'
import { setProductActive, setServiceActive } from '../_actions'

export type Product = {
  id: string
  institution_id: string
  name: string
  price: number
  stock: number
  active: boolean
  created_at: string
}

export type Service = {
  id: string
  institution_id: string
  name: string
  price: number
  active: boolean
  created_at: string
}

type StatusFilter = 'active' | 'archived' | 'all'

type ArchiveTarget = {
  id: string
  name: string
  kind: 'product' | 'service'
}

type Props = {
  products: Product[]
  services: Service[]
  role: UserRole
  currency: string
  sellProducts: boolean
  sellServices: boolean
}

const PAGE_SIZE = 50

export function CatalogView({ products, services, role, currency, sellProducts, sellServices }: Props) {
  const canWrite = role !== 'cashier'

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogKind, setDialogKind] = useState<'product' | 'service'>('product')
  const [editing, setEditing] = useState<{ id: string; name: string; price: number; stock?: number } | null>(null)

  // Archive confirm (only for active → archived direction)
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null)
  const [archiving, setArchiving] = useState(false)

  // Inline loading for restore (no confirm needed for non-destructive action)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Product filters
  const [productSearch, setProductSearch] = useState('')
  const [productStatus, setProductStatus] = useState<StatusFilter>('active')
  const [productPage, setProductPage] = useState(1)

  // Service filters
  const [serviceSearch, setServiceSearch] = useState('')
  const [serviceStatus, setServiceStatus] = useState<StatusFilter>('active')
  const [servicePage, setServicePage] = useState(1)

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase().trim()
    return products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (productStatus === 'active' && !p.active) return false
      if (productStatus === 'archived' && p.active) return false
      return true
    })
  }, [products, productSearch, productStatus])

  const filteredServices = useMemo(() => {
    const q = serviceSearch.toLowerCase().trim()
    return services.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false
      if (serviceStatus === 'active' && !s.active) return false
      if (serviceStatus === 'archived' && s.active) return false
      return true
    })
  }, [services, serviceSearch, serviceStatus])

  const productPages = Math.ceil(filteredProducts.length / PAGE_SIZE)
  const servicePages = Math.ceil(filteredServices.length / PAGE_SIZE)

  function openAdd(kind: 'product' | 'service') {
    setDialogKind(kind)
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(item: Product | Service, kind: 'product' | 'service') {
    setDialogKind(kind)
    setEditing(kind === 'product'
      ? { id: item.id, name: item.name, price: item.price, stock: (item as Product).stock }
      : { id: item.id, name: item.name, price: item.price }
    )
    setDialogOpen(true)
  }

  async function handleRestore(id: string, kind: 'product' | 'service') {
    setTogglingId(id)
    if (kind === 'product') await setProductActive(id, true)
    else await setServiceActive(id, true)
    setTogglingId(null)
  }

  async function handleArchiveConfirm() {
    if (!archiveTarget) return
    setArchiving(true)
    if (archiveTarget.kind === 'product') await setProductActive(archiveTarget.id, false)
    else await setServiceActive(archiveTarget.id, false)
    setArchiving(false)
    setArchiveTarget(null)
  }

  const activeProductCount = products.filter((p) => p.active).length
  const activeServiceCount = services.filter((s) => s.active).length

  // Module-level offerings gate (#3b): a service-only salon hides Products, a
  // retail kiosk hides Services. Per-item active/archived is separate (above).
  if (!sellProducts && !sellServices) {
    return (
      <div className="space-y-4">
        <PageHeader title="Catalog" subtitle="Products and services available for sale" />
        <EmptyState icon={Package} message="No offerings enabled. Turn on products or services in Settings." />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Catalog"
        subtitle="Products and services available for sale"
      />

      <Tabs defaultValue={sellProducts ? 'products' : 'services'}>
        <TabsList>
          {sellProducts && <TabsTrigger value="products">Products ({activeProductCount})</TabsTrigger>}
          {sellServices && <TabsTrigger value="services">Services ({activeServiceCount})</TabsTrigger>}
        </TabsList>

        {/* ── Products ─────────────────────────────────────────────────── */}
        {sellProducts && <TabsContent value="products">
          <div className="space-y-4 pt-4">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap gap-3 items-center">
                <Input
                  placeholder="Search products…"
                  value={productSearch}
                  onChange={(e) => { setProductSearch(e.target.value); setProductPage(1) }}
                  className="w-52"
                />
                <NativeSelect
                  value={productStatus}
                  onChange={(e) => { setProductStatus(e.target.value as StatusFilter); setProductPage(1) }}
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All</option>
                </NativeSelect>
                {(productSearch || productStatus !== 'active') && (
                  <Button variant="ghost" size="sm" onClick={() => { setProductSearch(''); setProductStatus('active'); setProductPage(1) }}>
                    Clear
                  </Button>
                )}
              </div>
              {canWrite && (
                <Button onClick={() => openAdd('product')}>Add product</Button>
              )}
            </div>

            {filteredProducts.length === 0 ? (
              products.length === 0 ? (
                <EmptyState
                  icon={Package}
                  message="No products yet. Add one to get started."
                  action={canWrite ? <Button onClick={() => openAdd('product')}>Add product</Button> : undefined}
                />
              ) : (
                <EmptyState icon={Package} message="No products match your filters." />
              )
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead>Status</TableHead>
                        {canWrite && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts
                        .slice((productPage - 1) * PAGE_SIZE, productPage * PAGE_SIZE)
                        .map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className={cn('font-medium', !p.active && 'opacity-60')}>{p.name}</TableCell>
                            <TableCell className={cn('tabular-nums', !p.active && 'opacity-60')}>{formatMoney(p.price, currency)}</TableCell>
                            <TableCell className={cn('tabular-nums', !p.active && 'opacity-60', p.stock < 0 && 'text-destructive')}>
                              {p.stock}
                            </TableCell>
                            <TableCell>
                              <Badge variant={p.active ? 'success' : 'secondary'}>
                                {p.active ? 'Active' : 'Archived'}
                              </Badge>
                            </TableCell>
                            {canWrite && (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-3">
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(p, 'product')}>
                                    Edit
                                  </Button>
                                  {p.active ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => setArchiveTarget({ id: p.id, name: p.name, kind: 'product' })}
                                    >
                                      Archive
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={togglingId === p.id}
                                      onClick={() => handleRestore(p.id, 'product')}
                                    >
                                      {togglingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Restore'}
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
                {productPages > 1 && (
                  <Pagination
                    page={productPage}
                    totalPages={productPages}
                    totalCount={filteredProducts.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setProductPage}
                  />
                )}
              </div>
            )}
          </div>
        </TabsContent>}

        {/* ── Services ─────────────────────────────────────────────────── */}
        {sellServices && <TabsContent value="services">
          <div className="space-y-4 pt-4">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap gap-3 items-center">
                <Input
                  placeholder="Search services…"
                  value={serviceSearch}
                  onChange={(e) => { setServiceSearch(e.target.value); setServicePage(1) }}
                  className="w-52"
                />
                <NativeSelect
                  value={serviceStatus}
                  onChange={(e) => { setServiceStatus(e.target.value as StatusFilter); setServicePage(1) }}
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All</option>
                </NativeSelect>
                {(serviceSearch || serviceStatus !== 'active') && (
                  <Button variant="ghost" size="sm" onClick={() => { setServiceSearch(''); setServiceStatus('active'); setServicePage(1) }}>
                    Clear
                  </Button>
                )}
              </div>
              {canWrite && (
                <Button onClick={() => openAdd('service')}>Add service</Button>
              )}
            </div>

            {filteredServices.length === 0 ? (
              services.length === 0 ? (
                <EmptyState
                  icon={Package}
                  message="No services yet. Add one to get started."
                  action={canWrite ? <Button onClick={() => openAdd('service')}>Add service</Button> : undefined}
                />
              ) : (
                <EmptyState icon={Package} message="No services match your filters." />
              )
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Status</TableHead>
                        {canWrite && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredServices
                        .slice((servicePage - 1) * PAGE_SIZE, servicePage * PAGE_SIZE)
                        .map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className={cn('font-medium', !s.active && 'opacity-60')}>{s.name}</TableCell>
                            <TableCell className={cn('tabular-nums', !s.active && 'opacity-60')}>{formatMoney(s.price, currency)}</TableCell>
                            <TableCell>
                              <Badge variant={s.active ? 'success' : 'secondary'}>
                                {s.active ? 'Active' : 'Archived'}
                              </Badge>
                            </TableCell>
                            {canWrite && (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-3">
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(s, 'service')}>
                                    Edit
                                  </Button>
                                  {s.active ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => setArchiveTarget({ id: s.id, name: s.name, kind: 'service' })}
                                    >
                                      Archive
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={togglingId === s.id}
                                      onClick={() => handleRestore(s.id, 'service')}
                                    >
                                      {togglingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Restore'}
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
                {servicePages > 1 && (
                  <Pagination
                    page={servicePage}
                    totalPages={servicePages}
                    totalCount={filteredServices.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setServicePage}
                  />
                )}
              </div>
            )}
          </div>
        </TabsContent>}
      </Tabs>

      <CatalogDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        kind={dialogKind}
        item={editing}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(v) => { if (!v) setArchiveTarget(null) }}
        title={`Archive ${archiveTarget?.kind ?? ''}?`}
        description={
          archiveTarget
            ? `"${archiveTarget.name}" will be hidden from new sales. Existing sale history is not affected.`
            : ''
        }
        confirmLabel="Archive"
        loading={archiving}
        onConfirm={handleArchiveConfirm}
      />
    </div>
  )
}
