// Explicit, read-only incident audit. Skipped during ordinary CI; no owner records are written.
import { execFileSync } from 'node:child_process'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LabelStudio } from './label-studio'
import { demoData } from '@/lib/demo'
import { labelContent } from '@/lib/label-persistence'
import {
  validateLabelDocument,
  type LabelDocument,
  type LabelElement,
} from '@/lib/label-studio'
import type { Item } from '@/lib/domain'
import { workspaceFonts } from '@/lib/label-font-catalog'
const capture = vi.hoisted(() => ({ document: null as LabelDocument | null }))
vi.mock('@/lib/label-client-export', () => ({
  downloadLabel: (bytes: Uint8Array) => {
    capture.document = JSON.parse(new TextDecoder().decode(bytes)).document
  },
  exportLabelPng: vi.fn(),
}))
afterEach(() => vi.unstubAllGlobals())
it.skipIf(process.env.RUN_LABEL_OWNER_AUDIT !== '1')(
  'restores the persisted incident candidate into the editable studio and verifies every editable property against its version history',
  async () => {
    const query =
      "SELECT set_config('app.business_id','8081ae5d-576f-4bf6-8dd4-a69b39a47bf1',false); SELECT jsonb_build_object('label_templates',(SELECT jsonb_agg(data) FROM label_templates),'label_versions',(SELECT jsonb_agg(data) FROM label_versions),'font_assets',(SELECT jsonb_agg(data) FROM font_assets),'graphic_assets',(SELECT jsonb_agg(data) FROM graphic_assets)) AS oven"
    const raw = execFileSync(
      '/opt/buildhome/node-deps/node_modules/.bin/netlify',
      ['db', 'connect', '--query', query, '--json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 4_000_000,
      },
    )
    const records = JSON.parse(raw)[0].workspace
    const candidate = records.label_templates.find(
      (d: Item) => d.id === '67b877f5-4229-4d01-a521-3103bafcf3f2',
    )
    expect(candidate?.revision).toBe(54)
    expect(candidate.elements).toHaveLength(7)
    const versions = records.label_versions.filter(
      (v: Item) => v.templateId === candidate.id,
    )
    expect(versions).toHaveLength(54)
    expect(
      versions.some(
        (v: Item) => labelContent(v.document) === labelContent(candidate),
      ),
    ).toBe(true)
    const fonts = workspaceFonts(records.font_assets)
    expect(fonts.some((font) => font.name.includes('Intro Rust'))).toBe(true)
    expect(fonts.some((font) => font.name.includes('Roughton Bogatha'))).toBe(
      true,
    )
    expect(
      labelContent(validateLabelDocument(structuredClone(candidate), fonts)),
    ).toBe(labelContent(candidate))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    )
    const workspace = {
      ...demoData(),
      ...records,
      label_templates: [candidate],
    }
    render(
      <LabelStudio
        workspace={workspace}
        onWorkspace={vi.fn()}
        ready={false}
        role="Owner"
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Saved Labels' }))
    await user.click(screen.getByRole('button', { name: /Open label/ }))
    expect(screen.getByLabelText('Label name')).toHaveValue('Bread Label')
    await user.click(
      screen.getByRole('button', { name: 'Export editable recovery file' }),
    )
    await waitFor(() => expect(capture.document).not.toBeNull())
    expect(labelContent(capture.document!)).toBe(labelContent(candidate))
    expect(
      capture.document!.elements.find(
        (e: LabelElement) => e.binding === 'recipe.ingredients',
      )!.rotation,
    ).toBe(180)
  },
  30000,
)
