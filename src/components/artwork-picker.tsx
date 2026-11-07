import { useState } from 'react'
import { type Item } from '@/lib/domain'
import { withLibraryArtwork } from '@/lib/artwork-library'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'

export function ArtworkPicker({
  assets,
  selected,
  choose,
  close,
}: {
  assets: Item[]
  selected: string
  choose: (id: string) => void
  close: () => void
}) {
  const [query, setQuery] = useState('')
  const options = withLibraryArtwork(assets).filter((a) =>
    `${a.name} ${a.aliases || ''}`.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="app-dialog artwork-picker">
        <DialogTitle>Choose artwork</DialogTitle>
        <DialogDescription>
          Optional label artwork. Your product photo and business logo stay
          separate.
        </DialogDescription>
        <label className="field">
          <span>Search artwork</span>
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="artwork-picker-grid">
          <button
            type="button"
            aria-pressed={!selected}
            onClick={() => choose('')}
          >
            <span className="artwork-none">None</span>
            <span>No artwork</span>
          </button>
          {options.map((a) => (
            <button
              type="button"
              key={a.id}
              aria-pressed={selected === a.id}
              onClick={() => choose(a.id)}
            >
              <img src={a.fileUrl} alt="" loading="lazy" />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
        {!options.length && <p className="form-hint">No matching artwork.</p>}
      </DialogContent>
    </Dialog>
  )
}
