Generated ingredient statements rendered main ingredient names in bold and all parenthesized subingredients in regular weight, including nested parentheses. Formatting used the structured ingredient relationships. Older text-only print snapshots used a parentheses-aware fallback. The statement wording and the saved label binding, font, size, color, spacing, rotation, alignment and dimensions were preserved.

Verification used this statement, including a comma within the structured main name “Flour, enriched”:

> Ingredients: Chocolate chips (sugar, chocolate (cocoa mass, cocoa butter), soy lecithin, vanilla), Flour, enriched (wheat flour, vitamins (niacin, iron)), Sea Salt

A Chromium check exercised the actual editor with synthetic workspace API responses, saved and reopened the label, duplicated it, switched Front and Back, compared both previews with browser-print markup, and downloaded both 300 DPI PNGs. Computed weights were 700 for main names and 400 for subingredients. The wrapped text stayed inside the original 248 × 150 pt text box at 10 pt. An intentionally short box produced an overflow warning without changing the font size or truncating the statement.

The PDF checks exercised both the vector exporter and the shared SVG exporter used for Front/Back designs. Regular and bold font faces were loaded for mixed text. A selected single-weight font retained its family with explicit bold outlines for main names. Each side's embedded PDF raster matched the shared renderer's PNG pixels.

Rendered evidence: [editor](previews/ingredient-statement-editor.png), [preview](previews/ingredient-statement-preview.png), [Front PNG](previews/ingredient-statement-front.png), and [Back PNG](previews/ingredient-statement-back.png).

The relevant label suites passed 141 tests, with one existing skipped test. The Chromium workflow and TypeScript check passed. Scoped lint introduced no diagnostics compared with the existing baseline of eight errors and seven warnings in the two label-studio source files. Physical printer output and live customer records were not exercised. Build validation remained assigned to the platform workflow.
