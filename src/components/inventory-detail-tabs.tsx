import type { ReactNode } from 'react'
import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import './ingredient-detail.css'

/** Shared planner dividers for inventory entities, including fabric materials. */
export function InventoryDetailTabs({
  inventory,
  purchasing,
  allergens,
  identification,
  label = 'Inventory detail sections',
  value,
  onValueChange,
}: {
  value?: string
  onValueChange?: (value: string) => void
  label?: string
  inventory: ReactNode
  purchasing: ReactNode
  allergens: ReactNode
  identification: ReactNode
}) {
  const [internalTab, setInternalTab] = useState('inventory')
  const tab = value ?? internalTab
  const setTab = onValueChange ?? setInternalTab
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="ingredient-details-tabs"
      data-detail-tab={tab}
    >
      <TabsList aria-label={label}>
        <TabsTrigger value="inventory">Inventory</TabsTrigger>
        <TabsTrigger value="purchasing">Purchasing</TabsTrigger>
        <TabsTrigger value="allergens">Ingredients &amp; Allergens</TabsTrigger>
        <TabsTrigger value="labels">Identification &amp; Notes</TabsTrigger>
      </TabsList>
      {Object.entries({
        inventory,
        purchasing,
        allergens,
        labels: identification,
      }).map(([key, content]) => (
        <TabsContent
          key={key}
          value={key}
          className="calculation-box ingredient-detail-card"
        >
          {content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
