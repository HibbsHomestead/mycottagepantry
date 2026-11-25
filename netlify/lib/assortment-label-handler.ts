import { randomUUID } from 'node:crypto'
import {
  assortmentJobCurrent,
  assortmentLabel,
  assortmentSignature,
  type AssortmentSpec,
} from '../../src/lib/assortment-labels'
import { number, type Item, type Workspace } from '../../src/lib/domain'

export async function handleAssortmentLabel(
  state: Workspace,
  data: Record<string, unknown>,
  actor: string,
  save: (table: string, item: Item) => Promise<void>,
) {
  const jobs = state.label_print_jobs.filter(
    (job) => job.assortmentKind === 'approved',
  )
  const replaced = new Set(
    jobs.flatMap((job) => job.assortmentSupersedes || []),
  )
  const active = jobs.filter((job) => !replaced.has(job.id))
  const base = {
    id: randomUUID(),
    outputType: 'print',
    createdAt: new Date().toISOString(),
    actor,
  }
  if (data.op === 'save-fixed' || data.op === 'approve') {
    const { spec, snapshot, limit } = assortmentLabel(
      state,
      data.spec as AssortmentSpec,
    )
    const fixed = data.op === 'save-fixed'
    let assortmentSupersedes: string[] = []
    if (fixed && (spec.mode !== 'fixed' || spec.batchId || spec.componentId))
      throw new Error(
        'Save a fixed outer assortment outside of a production run.',
      )
    if (
      !fixed &&
      (snapshot.warnings.length ||
        data.reviewed !== true ||
        data.signature !== assortmentSignature(snapshot))
    )
      throw new Error(
        'Resolve the label warnings and review a fresh actual-size preview before approving.',
      )
    if (!fixed && spec.batchId) {
      const outputJobs = active.filter(
        (job) =>
          job.batchId === spec.batchId && job.productId === spec.productId,
      )
      const groupJobs = outputJobs.filter(
        (job) => !job.assortmentSpec.componentId,
      )
      assortmentSupersedes = outputJobs
        .filter(
          (job) =>
            job.assortmentSpec.group === spec.group &&
            (!spec.componentId ||
              job.assortmentSpec.componentId === spec.componentId),
        )
        .map((job) => job.id)
      const byGroup = new Map(
        groupJobs.map((job) => [job.assortmentSpec.group, job]),
      )
      if (spec.componentId) {
        const outer = byGroup.get(spec.group)
        if (
          !outer ||
          !assortmentJobCurrent(state, outer) ||
          assortmentSignature([spec.lines, spec.containers]) !==
            assortmentSignature([
              outer.assortmentSpec.lines,
              outer.assortmentSpec.containers,
            ])
        )
          throw new Error(
            'Approve the matching outer assortment for this packing group before its component labels.',
          )
      } else {
        const other = [...byGroup.entries()].reduce(
          (sum, [group, job]) =>
            sum + (group === spec.group ? 0 : job.assortmentSpec.containers),
          0,
        )
        if (other + spec.containers > limit)
          throw new Error('Packing groups together exceed the run output.')
      }
    } else if (!fixed && data.revises) {
      const previous = active.find(
        (job) =>
          job.id === data.revises &&
          !job.batchId &&
          Boolean(job.assortmentSpec.componentId) === Boolean(spec.componentId),
      )
      if (!previous)
        throw new Error(
          'The earlier label is no longer current. Reload and review as a new job.',
        )
      assortmentSupersedes = [previous.id]
    }
    await save('label_print_jobs', {
      ...base,
      name: spec.name,
      templateId: spec.templateId,
      productId: spec.productId,
      batchId: spec.batchId,
      copies: spec.copies,
      assortmentKind: fixed ? 'fixed' : 'approved',
      assortmentSpec: spec,
      assortmentSnapshot: snapshot,
      assortmentSupersedes,
    })
  } else if (
    data.op === 'check-print' ||
    data.op === 'printed' ||
    data.op === 'applied'
  ) {
    const job = jobs.find((item) => item.id === data.jobId)
    const copies = number(data.copies, 'Confirmed label copies', 1)
    if (!job || !Number.isInteger(copies) || copies > job.copies)
      throw new Error('Confirm a valid copy count for an approved job.')
    const events = state.label_print_jobs.filter(
      (item) => item.assortmentJobId === job.id,
    )
    if (!assortmentJobCurrent(state, job))
      throw new Error(
        'Source information or packing selection changed. Approve a new job before printing or applying labels.',
      )
    if (data.op === 'check-print') return
    if (data.op === 'applied') {
      const total = (kind: string) =>
        events
          .filter((item) => item.assortmentKind === kind)
          .reduce((sum, item) => sum + item.copies, 0)
      if (total('applied') + copies > Math.min(job.copies, total('printed')))
        throw new Error(
          'Confirm printing before application and do not exceed the approved copy count.',
        )
    }
    await save('label_print_jobs', {
      ...base,
      name: job.name,
      templateId: job.templateId,
      productId: job.productId,
      batchId: job.batchId,
      copies,
      assortmentKind: data.op,
      assortmentJobId: job.id,
    })
  } else throw new Error('Choose an assortment label action.')
}
