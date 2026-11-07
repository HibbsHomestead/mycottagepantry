/** Normalize only formatting text introduced into the admin head by HTML processing.
 * This runs after head parsing and before React; script/style contents are preserved.
 */
export const adminHeadBootScript =
  "if(window.location.pathname==='/admin'){for(const node of Array.from(document.head.childNodes)){if(node.nodeType===3&&!node.textContent.trim())node.remove()}}"
