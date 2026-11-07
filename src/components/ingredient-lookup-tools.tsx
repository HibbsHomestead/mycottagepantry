import type { Item, Workspace } from '@/lib/domain'
import {
  CatalogContribution,
  CatalogLookup,
  CatalogUpdates,
} from './catalog-lookup'
import { PackagePhotoImport } from './package-photo-import'
export function IngredientLookupTools({
  draft,
  workspace,
  apply,
  onScan,
  autoSearch,
  packageSetup,
  onSourceUrl,
  existing = false,
}: {
  draft: Record<string, Item[string]>
  workspace: Workspace
  apply: (patch: Record<string, Item[string]>) => void
  onScan?: () => void
  autoSearch?: boolean
  packageSetup?: boolean
  onSourceUrl?: (url: string) => void
  existing?: boolean
}) {
  return (
    <>
      <CatalogLookup
        draft={draft}
        workspace={workspace}
        apply={apply}
        onScan={onScan}
        autoSearch={autoSearch}
        packageSetup={packageSetup}
        onSourceUrl={onSourceUrl}
      />
      {workspace.settings?.[0]?.packagePhotoExtractionAllowed === true && (
        <PackagePhotoImport
          processingReady={
            workspace.settings[0].packagePhotoProcessingReady === true
          }
          draft={draft}
          apply={apply}
          packageSetup={packageSetup}
        />
      )}
      {existing && <CatalogUpdates draft={draft} apply={apply} />}
      <CatalogContribution draft={draft} />
    </>
  )
}
