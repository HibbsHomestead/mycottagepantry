// Isolated browser review; API responses are supplied by Playwright.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import {
  ItemDeletionProvider,
  ItemDeleteButton,
} from '../components/item-deletion'
import { TooltipProvider } from '../components/ui/tooltip'
import '../styles.css'
import '../workspace.css'
function Review() {
  const [removed, setRemoved] = useState(false)
  const blocked = { id: 'blocked-fixture', name: 'Disposable linked prep' }
  const unused = { id: 'unused-fixture', name: 'Disposable unused prep' }
  return (
    <TooltipProvider>
      <ItemDeletionProvider
        canDelete
        onWorkspace={() => setRemoved(true)}
        onDeleted={() => {}}
      >
        <main style={{ padding: 24 }}>
          <h1>Deletion review fixtures</h1>
          <article className="recipe-card">
            <h2>{blocked.name}</h2>
            <ItemDeleteButton table="recipes" item={blocked} />
          </article>
          <table>
            <tbody>
              <tr>
                <td>{unused.name}</td>
                <td>
                  <ItemDeleteButton table="recipes" item={unused} />
                </td>
              </tr>
            </tbody>
          </table>
          {removed && <p role="status">Deletion response received</p>}
        </main>
      </ItemDeletionProvider>
    </TooltipProvider>
  )
}
export function mountReview() {
  createRoot(document.getElementById('root')!).render(<Review />)
}
