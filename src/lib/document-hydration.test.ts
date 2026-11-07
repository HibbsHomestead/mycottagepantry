import { afterEach, expect, it } from 'vitest'
import { adminHeadBootScript } from './document-hydration'
afterEach(() => {
  document.head.replaceChildren()
  history.replaceState({}, '', '/')
})
it('normalizes only direct admin head formatting without altering elements or policies', () => {
  history.replaceState({}, '', '/admin')
  document.head.innerHTML =
    '\n<meta name="sample" content="preserved">\n<style>.sample { color: purple; }\n</style>\n<script type="application/json">{ "retain": true }\n</script>\n'
  const elements = Array.from(document.head.children),
    before = elements.map((e) => e.outerHTML)
  new Function(adminHeadBootScript)()
  expect(Array.from(document.head.childNodes)).toEqual(elements)
  expect(elements.map((e) => e.outerHTML)).toEqual(before)
})
it('leaves customer routes and meaningful text alone', () => {
  history.replaceState({}, '', '/oven')
  document.head.append(document.createTextNode('\n'))
  new Function(adminHeadBootScript)()
  expect(document.head.childNodes).toHaveLength(1)
  history.replaceState({}, '', '/admin')
  document.head.append(document.createTextNode('keep'))
  new Function(adminHeadBootScript)()
  expect(document.head.textContent).toBe('keep')
})
