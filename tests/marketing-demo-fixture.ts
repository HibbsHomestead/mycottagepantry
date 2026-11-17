import { demoData, rollup } from "../src/lib/demo";
import { convert } from "../src/lib/domain";

/** Browser-only sample records. This module is never imported by the app. */
export function marketingDemo() {
  const workspace = demoData();
  Object.assign(workspace.settings[0], {
    name: "Meadow & Crumb Demo Bakery",
    owner: "Sample business",
    email: "demo@example.invalid",
    address: "Sample kitchen · demonstration only",
    jurisdiction: "Sample jurisdiction · review local requirements",
    appearance: { theme: "cottage", mode: "light" },
    currentPantryView: "cards",
  });
  workspace.graphic_assets = [];
  const photograph = (
    item: (typeof workspace.ingredients)[number],
    photo: string,
  ) => {
    const id = `marketing-photo-${item.id}`;
    item.imageAssetId = id;
    workspace.graphic_assets.push({
      id,
      name: `${item.name} sample photograph`,
      fileUrl: `/demo-photos/${photo}.webp`,
      widthPx: 800,
      heightPx: 600,
    });
  };
  const ingredientPhotos: Record<string, string> = {
    flour: "flour",
    apflour: "flour",
    sugar: "sugar",
    butter: "butter",
    eggs: "eggs",
    vanilla: "vanilla",
    cinnamon: "cinnamon",
    chips: "chips",
  };
  for (const item of workspace.ingredients) {
    if (ingredientPhotos[item.id]) {
      photograph(item, ingredientPhotos[item.id]);
      item.category = "Market staples";
    }
    if (!item.compoundRecipeId) {
      item.purchaseQuantity ??= 1;
      item.purchaseUnit ??= item.storageUnit || item.unit;
      item.packagePrice ??=
        item.cost *
        convert(
          item.purchaseQuantity,
          item.purchaseUnit,
          item.unit,
          item.conversions,
        );
    }
    if (item.expires) item.expires = "2027-01-20";
    item.vendor = "Sample wholesale supplier";
  }
  const pumpkin = {
    id: "sample-pumpkin",
    name: "Canned pumpkin purée",
    quantity: 3400,
    unit: "g",
    storageUnit: "g",
    recipeUnit: "g",
    cost: 0.0055,
    threshold: 1500,
    category: "Market staples",
    usedAs: "ingredient",
    reviewed: true,
    purchaseQuantity: 425,
    purchaseUnit: "g",
    packagePrice: 2.3375,
    statement: "Pumpkin",
    location: "Dry storage",
    vendor: "Sample wholesale supplier",
  };
  workspace.ingredients.push(pumpkin);
  photograph(pumpkin, "pumpkin");
  for (const recipe of workspace.recipes) {
    const key: Record<string, string> = {
      bread: "bread",
      cookies: "cookies",
      rolls: "rolls",
      cream: "cream",
      filling: "filling",
    };
    photograph(recipe, key[recipe.id]);
  }
  for (const product of workspace.products) {
    photograph(
      product,
      product.recipeId === "bread"
        ? "bread"
        : product.recipeId === "cookies"
          ? "cookies"
          : "rolls",
    );
  }
  rollup(workspace);
  return workspace;
}
