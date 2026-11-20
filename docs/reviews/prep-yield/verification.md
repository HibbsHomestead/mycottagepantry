Evidence: workspace-app previously rendered free text for yieldUnit and changed only compound when toggled; no grams reset was found. Server validation accepted registry units but blocked an existing output unit change. The original checkbox text mentioned only g. The reported new-prep grams-only restriction was not reproduced; the existing-output lock was confirmed.

Changed shared pieces: RecipeYieldFields, prep-yield registry filter, recipe save validation and component conversion error guidance. Existing componentStock, validateRecipeComponents, convert, recipeCost and production services retained declared-unit semantics and the prepared-stock model. Existing output units remain immutable in recipe editing; an explicit migration is required to change them.

Passed: 55 tests across yield-fields, recipe-components, isolated workspace-handler database fixtures, production, costing and recipe-base units. TypeScript and focused lint passed. Browser: prep-yield.browser.spec.ts, desktop 1440 and phone 390, both passed; intercepted disposable fixtures verified oz selection, toggle preservation, save, reload and reopen. Screenshots: yield-1440.png and yield-390.png. Phone layout was visually inspected for checkbox placement and footer access.

The real database fixtures separately verified 8 oz consumed as 1 oz, 1 cup consumed as 1 tbsp, count outputs and existing grams, save/reopen persistence, one output across repeated saves, rejected saved-output relabeling, and missing weight/volume conversion. Cost tests asserted compatible component totals. No real business data changed.

Additional browser regression: recipe-base-workflow.spec.ts failed at its expected cost 7.97 versus actual 4.97 after the UI/save assertions. Costing code was not changed to accommodate that expectation. The focused recipe-base unit suite passed.

Deployed browser checks, preview URL and exact deployed revision: not verified. The platform deploy follows this editing run; localhost fixtures are not deployed evidence. Live save/reopen/component checks remain outstanding. The customer's actual finishing-sugar recipe was not edited.
