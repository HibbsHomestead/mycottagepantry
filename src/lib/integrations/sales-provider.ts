/** Planned provider contract only; authorization and synchronization do not exist. */
export interface ImportedSale {
  externalTransactionId: string
  transactionDate: string
  grossSales: number
  discounts: number
  salesTaxCollected: number
  processingFees: number
  refunds: number
  currency: string
}
export interface SalesProvider {
  id: string
  status: 'planned' | 'not_connected' | 'connected' | 'demo'
  fetchSales(start: string, end: string): Promise<ImportedSale[]>
}
export const squareProvider: SalesProvider = {
  id: 'square',
  status: 'planned',
  async fetchSales() {
    throw new Error(
      'Square sales sync is planned. Authorization and transaction imports are not yet implemented.',
    )
  },
}
