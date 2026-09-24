import { useState } from 'react'
import type { PickedEmployee } from '../../components/EmployeePicker'
import { ExchangeModal } from './ExchangeModal'
import { SaleModal } from './SaleModal'

/** Kelola dialog tukar/beli, termasuk "tukar ditolak → proses sebagai pembelian". */
export function useTransaksiDialogs() {
  const [ex, setEx] = useState<{ emp: PickedEmployee | null } | null>(null)
  const [sale, setSale] = useState<{ emp: PickedEmployee | null; sku?: string } | null>(null)
  const dialogs = <>
    {ex && <ExchangeModal initial={ex.emp} onClose={() => setEx(null)} onBuyInstead={(emp, sku) => { setEx(null); setSale({ emp, sku }) }} />}
    {sale && <SaleModal initial={sale.emp} initialSku={sale.sku} onClose={() => setSale(null)} />}
  </>
  return { openExchange: (emp: PickedEmployee | null = null) => setEx({ emp }), openSale: (emp: PickedEmployee | null = null) => setSale({ emp }), dialogs }
}

