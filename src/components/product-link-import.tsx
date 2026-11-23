import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import "./product-import-review.css";
import { applyPurchaseSetup } from "@/lib/purchase-setup";
import { FormErrorNotice } from "./form-error-notice";
import {
  ProductImportFailure,
  retryDeadline,
  type ProductImportDiagnostics,
} from "@/lib/product-import-diagnostics";
import { ovenTimestamp } from "@/lib/oven-dates";
import { foodProduct, inventoryProductLabels } from "@/lib/inventory-product";
import { isPackaging } from "@/lib/pantry-category";
import {
  productUrl,
  readImportResponse,
  productImportResponse,
  ProductHumanVerificationError,
} from "@/lib/product-import-response";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { packageCost, precise } from "@/lib/ingredients";
import { convert } from "@/lib/domain";
import { inventoryPackagePreview } from "@/lib/inventory-package";
import type { Item, Workspace } from "@/lib/domain";
import { ProductVendorReview } from "./product-vendor-review";
import { ItemPhotoField } from "./item-photo-field";
import { LookupActionContext, LookupError } from "./lookup-error";
import { productOfferDefault } from "@/lib/product-import-offers";
import {
  blankIngredientImportPatch,
  commonImportFields,
  ingredientImportFields,
  importValuePresent,
} from "@/lib/ingredient-import-draft";
type Product = {
  fields: Record<string, string | number>;
  title: string;
  imageUrl: string;
  sourceUrl: string;
  requestedUrl?: string;
  checkedAt: string;
  warnings: string[];
  conditions: string[];
};
export const importLabels: Record<string, string> = {
  ...inventoryProductLabels,
  name: "Name",
  brand: "Brand",
  vendor: "Vendor",
  purchaseQuantity: "Purchase package quantity",
  amountPerPackage: "Stock quantity in ONE purchase unit",
  unit: "Stock unit",
  priceBasisQuantity: "Purchase units covered by source price",
  packageRelationship: "Source package relationship",
  purchaseUnit: "Purchase unit",
  packCount: "Pack count",
  packagePrice: "Package price",
  currency: "Currency",
  barcode: "Barcode",
  retailerSku: "Retailer SKU (not barcode)",
  notes: "Description / notes",
  subingredients: "Source ingredient statement",
  sourceContains: "Source Contains statement",
  sourceMayContain: "Source May contain statement",
};
export function ReviewText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= 240) return <>{text}</>;
  return (
    <>
      {expanded ? text : `${text.slice(0, 240)}…`}{" "}
      <button
        type="button"
        className="text-button product-import-expand"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Show less" : "Show full text"}
      </button>
    </>
  );
}
function reviewValue(key: string, value: string | number, currency: string) {
  if (key === "packagePrice" && importValuePresent(value)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
      }).format(Number(value));
    } catch {
      return `${currency} ${value}`;
    }
  }
  return String(value);
}
function ReviewTextEditor({
  value,
  onChange,
}: {
  value: string | number;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = ref.current!;
    const details = node.closest("details")!;
    const grow = () => {
      if (!details.open) return;
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
    };
    grow();
    details.addEventListener("toggle", grow);
    window.addEventListener("resize", grow);
    return () => {
      details.removeEventListener("toggle", grow);
      window.removeEventListener("resize", grow);
    };
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
export function ProductLinkImport({
  draft,
  apply,
  onWorkspace,
  onBusyChange,
  existing = false,
  compact = false,
  onVendorsChange,
  settings,
  populateDraft = false,
  packageSetup = false,
  vendors = [],
  afterLookup,
  lookupPanel = false,
}: {
  draft: Item | Record<string, Item[string]>;
  apply: (patch: Record<string, Item[string]>) => void;
  onWorkspace: (w: Workspace) => void;
  onBusyChange?: (busy: boolean) => void;
  settings?: Item;
  compact?: boolean;
  existing?: boolean;
  onVendorsChange?: (vendors: Item[]) => void;
  populateDraft?: boolean;
  packageSetup?: boolean;
  vendors?: Item[];
  /** Additional lookup controls, before status messages and the inline review. */
  afterLookup?: ReactNode | ((selectUrl: (url: string) => void) => ReactNode);
  lookupPanel?: boolean;
}) {
  const reviewId = useId();
  const [diagnostics, setDiagnostics] =
    useState<ProductImportDiagnostics | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [errorStatus, setErrorStatus] = useState<number | undefined>();
  const [lookupAction, setLookupAction] = useState("url");
  const [clock, setClock] = useState(() => Date.now());
  const [attempts, setAttempts] = useState({ url: "", count: 0 });
  const [url, setUrl] = useState(
      String(draft.productSourceUrl || draft.productUrl || ""),
    ),
    [products, setProducts] = useState<Product[]>([]),
    [discardReview, setDiscardReview] = useState(false),
    [conditionalPriceConfirmed, setConditionalPriceConfirmed] = useState(false),
    [index, setIndex] = useState(-1),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [applied, setApplied] = useState(false),
    [imageFailed, setImageFailed] = useState(false),
    [vendorChoice, setVendorChoice] = useState<Item | null>(null),
    [replaceReviewed, setReplaceReviewed] = useState(false),
    [copied, setCopied] = useState(false),
    [pasting, setPasting] = useState(false),
    [verificationUrls, setVerificationUrls] = useState<string[]>([]),
    [uploadingScreenshot, setUploadingScreenshot] = useState(false),
    [screenshotId, setScreenshotId] = useState(""),
    [screenshotAssets, setScreenshotAssets] = useState<Item[]>([]),
    [edits, setEdits] = useState<Record<string, string | number>>({});
  const [importNotice, setImportNotice] = useState("");
  const [offerNotice, setOfferNotice] = useState("");
  useEffect(() => {
    if (!error) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [error]);

  const latest = useRef({ draft, apply, vendors });
  useLayoutEffect(() => {
    latest.current = { draft, apply, vendors };
  }, [draft, apply, vendors]);
  useEffect(() => {
    onBusyChange?.(busy || uploadingScreenshot);
  }, [busy, uploadingScreenshot, onBusyChange]);
  const pending = useRef(false);
  const reviewReturnFocus = useRef<HTMLButtonElement | null>(null);
  const verificationUrl = verificationUrls.at(-1);
  const screenshot = screenshotAssets.find(
    (asset) => asset.id === screenshotId,
  );
  const source = products[index];
  const product = source
    ? {
        ...source,
        fields: {
          ...ingredientImportFields(source.fields, draft, packageSetup),
          ...edits,
        },
      }
    : undefined;
  const packaging = isPackaging(draft);
  const ManualReference = compact && packaging ? "details" : "div";
  const food = foodProduct(draft);
  const itemWord = packaging
    ? "packaging"
    : food
      ? "ingredient"
      : "inventory item";
  const statementKeys = [
    "subingredients",
    "sourceContains",
    "sourceMayContain",
  ];
  const material =
    draft.usedAs === "material" || draft.categoryId === "craft-materials";
  const allowed = (key: string) =>
    (food || !statementKeys.includes(key)) &&
    (material ||
      ![
        "materialType",
        "fabricWidth",
        "widthUnit",
        "yarnLength",
        "yarnLengthUnit",
        "yarnWeight",
        "yarnWeightUnit",
      ].includes(key));
  const applicableSelected = selected.filter(allowed);
  const conditionalPrice =
    selected.includes("packagePrice") &&
    !!product?.conditions.some((condition) =>
      /member(?:ship|s)?[ -]*(?:only|price|pricing)|subscription|subscribe|recurring/i.test(
        condition,
      ),
    );
  const replacesReviewed =
    !!draft.reviewed &&
    applicableSelected.some(
      (key) =>
        statementKeys.includes(key) &&
        String(draft[key] || "") !== String(product?.fields[key] || ""),
    );
  const availableFields = product
    ? {
        ...Object.fromEntries(
          [
            "name",
            "brand",
            "notes",
            "packagePrice",
            "currency",
            "purchaseUnit",
            "amountPerPackage",
            "unit",
            "priceBasisQuantity",
          ].map((key) => [key, product.fields[key] ?? ""]),
        ),
        ...Object.fromEntries(
          Object.entries(product.fields).filter(([key]) => allowed(key)),
        ),
        ...(!populateDraft &&
        !product.fields.amountPerPackage &&
        product.fields.packageSize
          ? {
              purchaseQuantity: product.fields.purchaseQuantity ?? "",
              purchaseUnit: product.fields.purchaseUnit ?? "",
            }
          : {}),
      }
    : {};
  const packageKeys = [
    "packagePrice",
    "purchaseQuantity",
    "purchaseUnit",
    "amountPerPackage",
    "packCount",
    "unit",
    "priceBasisQuantity",
  ];
  const packageProposed =
    existing &&
    Object.entries(availableFields).some(
      ([key, value]) => packageKeys.includes(key) && importValuePresent(value),
    );
  const packageSelected =
    existing && applicableSelected.some((key) => packageKeys.includes(key));
  const resultSources = source ? [source] : products;
  const unavailable = resultSources.length
    ? [
        "name",
        "brand",
        ...(packageSetup ||
        resultSources.some((result) => result.fields.amountPerPackage != null)
          ? ["amountPerPackage", "unit"]
          : ["purchaseQuantity"]),
        "purchaseUnit",
        "packagePrice",
        "barcode",
        ...(food ? statementKeys : []),
      ].filter((key) =>
        resultSources.every(
          (result) => !importValuePresent(result.fields[key]),
        ),
      )
    : [];
  function preselectEmptyFields(candidate?: Product) {
    if (!candidate) {
      setSelected([]);
      return;
    }
    const current = latest.current.draft;
    const fields = ingredientImportFields(
      candidate.fields,
      current,
      packageSetup,
    );
    const patch = blankIngredientImportPatch(
      fields,
      current,
      latest.current.vendors,
      candidate.sourceUrl,
      packageSetup,
    );
    setSelected(
      Object.keys(patch).filter(
        (key) => key !== "vendorId" && key !== "packageSize" && allowed(key),
      ),
    );
  }
  let calculation = "";
  if (product) {
    try {
      const proposal = {
        ...draft,
        ...Object.fromEntries(
          applicableSelected.map((k) => [k, product.fields[k]]),
        ),
      };
      if (
        applicableSelected.includes("priceBasisQuantity") &&
        proposal.priceBasisQuantity &&
        proposal.packagePrice != null
      )
        proposal.packagePrice =
          Number(proposal.packagePrice) / Number(proposal.priceBasisQuantity);
      if (proposal.amountPerPackage != null) {
        const { plan, error } = inventoryPackagePreview(proposal);
        if (!plan || error) throw new Error("Incomplete package");
        calculation =
          plan.unitCost == null
            ? "Cost per package is not set. Review the selected offer or enter the cost manually."
            : `1 ${proposal.purchaseUnit} = ${precise(plan.amountPerPackage!)} ${proposal.unit}. ${proposal.currency || "USD"} ${precise(Number(proposal.packagePrice))} ÷ ${precise(plan.amountPerPackage!)} = ${precise(plan.unitCost)} per ${proposal.unit}`;
      } else {
        const cost = packageCost(proposal as Item);
        calculation = `${proposal.purchaseQuantity} ${proposal.purchaseUnit} for ${proposal.currency || "USD"} ${proposal.packagePrice} → ${precise(cost.contents)} ${cost.unit} → ${precise(cost.unitCost)} per ${cost.unit}`;
        if (proposal.recipeUnit)
          calculation += ` · ${precise(cost.unitCost * convert(1, proposal.recipeUnit, cost.unit, proposal.conversions))} per recipe ${proposal.recipeUnit}`;
      }
    } catch {
      calculation =
        "Complete package details and any required conversion to calculate cost. No density or package contents are assumed.";
    }
  }
  async function search() {
    setLookupAction("url");
    // This handler runs only from explicit Import/Retry clicks.
    // eslint-disable-next-line react-hooks/purity
    const clickedAt = Date.now();
    if (
      pending.current ||
      uploadingScreenshot ||
      (!lookupPanel && verificationUrls.includes(url.trim())) ||
      (attempts.url === url.trim() &&
        ((!lookupPanel && attempts.count >= 3) || clickedAt < retryAt))
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    setErrorCode(undefined);
    setDiagnostics(null);
    setImportNotice("");
    setApplied(false);
    try {
      const validatedUrl = productUrl(url);
      const count = attempts.url === validatedUrl ? attempts.count : 0;
      setAttempts({ url: validatedUrl, count: count + 1 });
      const r = await fetch("/api/workspace?productImport=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: validatedUrl }),
        credentials: "same-origin",
      });
      setRetryAt(
        !r.ok &&
          (r.headers.has("retry-after") ||
            /(^|\.)amazon\.[a-z.]+$/i.test(new URL(validatedUrl).hostname))
          ? retryDeadline(r.headers.get("retry-after"))
          : 0,
      );
      // eslint-disable-next-line react-hooks/purity -- Response arrival inside the click handler.
      setClock(Date.now());
      const raw = await readImportResponse(r);
      const parsed = productImportResponse.safeParse(raw);
      if (!parsed.success)
        throw new Error(
          "The product service did not return valid product details. No suggestions were applied. Retry or enter details manually.",
        );
      const data = parsed.data;
      setApplied(false);
      setEdits({});
      setDiscardReview(false);
      setVendorChoice(null);
      setReplaceReviewed(false);
      setCopied(false);
      setProducts(data.products);
      const offerDefault = productOfferDefault(data.products);
      setIndex(offerDefault.index);
      setOfferNotice(offerDefault.notice);
      preselectEmptyFields(data.products[offerDefault.index]);
      setImageFailed(false);
      setConfirmed(false);
      setConditionalPriceConfirmed(false);
      setDiagnostics(null);
      setRetryAt(0);
      setAttempts({ url: validatedUrl, count: 0 });
    } catch (e) {
      if (e instanceof ProductHumanVerificationError) {
        const blockedUrl = productUrl(url);
        setVerificationUrls((old) => [...old, blockedUrl]);
        if (!lookupPanel) setPasting(true);
      }
      setDiagnostics(
        e instanceof ProductImportFailure
          ? e.diagnostics
          : {
              requestedAt: new Date().toISOString(),
              requestedUrl: url.trim(),
              source: "backend",
              hops: [],
            },
      );
      setErrorCode(
        e instanceof ProductImportFailure ||
          e instanceof ProductHumanVerificationError
          ? e.code
          : undefined,
      );
      setErrorStatus(e instanceof ProductImportFailure ? e.status : undefined);
      let invalidUrl = false;
      try {
        productUrl(url);
      } catch {
        invalidUrl = true;
      }
      setError(
        invalidUrl
          ? (e as Error).message
          : `${lookupPanel ? "Product details unavailable. " : ""}${e instanceof Error ? e.message : "Product retrieval is unavailable."} Your entries are still in this form. Keep this page open to continue manually.`,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function clearReview() {
    setProducts([]);
    setIndex(-1);
    setEdits({});
    setDiscardReview(false);
  }
  function cancelReview() {
    if (Object.keys(edits).length || confirmed || replaceReviewed) {
      setDiscardReview(true);
      return;
    }
    setProducts([]);
    setIndex(-1);
    setEdits({});
    setDiscardReview(false);
  }
  async function commit() {
    if (
      !product ||
      pending.current ||
      (packageSelected && !confirmed) ||
      (conditionalPrice && !conditionalPriceConfirmed) ||
      (replacesReviewed && !replaceReviewed) ||
      (selected.includes("vendor") && !vendorChoice)
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    const patch: Record<string, Item[string]> = Object.fromEntries(
      applicableSelected
        .filter(
          (key) =>
            key !== "vendor" &&
            key !== "packageSize" &&
            importValuePresent(product.fields[key]),
        )
        .map((k) => [k, product.fields[k]]),
    );
    if (patch.packagePrice != null) {
      const unapprovedBasis = [
        "purchaseQuantity",
        "purchaseUnit",
        "amountPerPackage",
        "unit",
        "currency",
      ].some(
        (key) =>
          importValuePresent(product.fields[key]) &&
          String(product.fields[key]) !== String(draft[key] ?? "") &&
          !applicableSelected.includes(key),
      );
      if (unapprovedBasis) {
        setError(
          "Select and review the purchase unit, package contents, stock unit and currency before accepting this price. Existing package fields have a different basis.",
        );
        pending.current = false;
        setBusy(false);
        return;
      }
      if (
        !Number.isFinite(Number(patch.packagePrice)) ||
        Number(patch.packagePrice) < 0
      ) {
        setError(
          "Enter a definite non-negative price for this purchase unit. Missing price is unknown.",
        );
        pending.current = false;
        setBusy(false);
        return;
      }
    }
    const packageChanged = applicableSelected.some((key) =>
      [
        "amountPerPackage",
        "purchaseUnit",
        "unit",
        "packagePrice",
        "priceBasisQuantity",
      ].includes(key),
    );
    if (packageChanged && product.fields.amountPerPackage != null) {
      const proposal: Record<string, Item[string]> = {
        ...draft,
        ...patch,
        ...(patch.unit && !packageSetup ? { storageUnit: patch.unit } : {}),
      };
      if (patch.priceBasisQuantity != null) {
        const basis = Number(patch.priceBasisQuantity);
        if (!(basis > 0) || !Number.isFinite(basis)) {
          setError("Confirm how many purchase units the source price covers.");
          pending.current = false;
          setBusy(false);
          return;
        }
        if (patch.packagePrice != null)
          patch.packagePrice = Number(patch.packagePrice) / basis;
      }
      if (
        patch.amountPerPackage != null &&
        (!proposal.purchaseUnit || !proposal.unit)
      ) {
        setError("Choose the purchase unit and stock unit for these contents.");
        pending.current = false;
        setBusy(false);
        return;
      }
      if (!packageSetup && patch.amountPerPackage != null) {
        // Existing editors save through PurchaseSetup. Keep historical receipts untouched.
        const price = patch.packagePrice ?? draft.packagePrice;
        if (price != null && price !== "") {
          try {
            Object.assign(
              patch,
              applyPurchaseSetup(draft as Item, {
                ...proposal,
                packagePrice: price,
                purchaseQuantity: 1,
                purchaseSetup: {
                  packageUnit: proposal.purchaseUnit,
                  price,
                  stockUnits: patch.amountPerPackage,
                },
                purchaseSetupConfirmed: true,
              }),
            );
            // applyPurchaseSetup returns a full draft; only accepted fields and conversion are applied.
            for (const key of Object.keys(patch))
              if (
                !applicableSelected.includes(key) &&
                ![
                  "purchaseSetup",
                  "purchaseSetupConfirmed",
                  "purchaseQuantity",
                  "conversions",
                  "legacyPurchaseBasis",
                  "storageUnit",
                ].includes(key)
              )
                delete patch[key];
          } catch (error) {
            setError((error as Error).message);
            pending.current = false;
            setBusy(false);
            return;
          }
        }
      }
    }
    if (!packageSetup && patch.unit) patch.storageUnit = patch.unit;
    if (selected.includes("vendor") && vendorChoice) {
      patch.vendorId = vendorChoice.id;
      patch.vendor = vendorChoice.name;
    }
    if (
      selected.some((key) =>
        ["purchaseQuantity", "purchaseUnit", "amountPerPackage"].includes(key),
      )
    ) {
      patch.onlinePackageQuantity = source?.fields.purchaseQuantity;
      patch.onlinePackageUnit = source?.fields.purchaseUnit;
    }
    if (source?.fields.packageSize)
      patch.productSourcePackageSize = source.fields.packageSize;
    if (selected.includes("packagePrice")) {
      patch.listedOnlinePrice = product.fields.packagePrice;
      // A listing never supplies the actual amount paid.
      patch.purchasePriceConfirmed = false;
    }
    const textCount = Object.keys(patch).filter(
      (key) =>
        key !== "vendorId" &&
        !key.startsWith("onlinePackage") &&
        ![
          "listedOnlinePrice",
          "purchasePriceConfirmed",
          "productSourcePackageSize",
        ].includes(key),
    ).length;
    patch.productSourceUrl = product.sourceUrl;
    patch.productRequestedUrl = product.requestedUrl || product.sourceUrl;
    patch.productCheckedAt = product.checkedAt;
    if (
      applicableSelected.some((k) =>
        ["subingredients", "sourceContains", "sourceMayContain"].includes(k),
      )
    )
      patch.reviewed = false;
    try {
      // Provenance alone is not an applied product field.
      const useful =
        textCount > 0 ||
        !!patch.imageAssetId ||
        (!populateDraft &&
          selected.includes("packagePrice") &&
          importValuePresent(product.fields.packagePrice));
      if (useful) apply(patch);
      setApplied(useful);
      if (populateDraft)
        setImportNotice(
          useful
            ? `Selected details applied to this form; ${itemWord} not saved yet.`
            : "No usable fields were applied. Your entries are unchanged.",
        );
      setProducts([]);
      setIndex(-1);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function renderField(key: string, value: string | number) {
    const label = importLabels[key] || key;
    const longText = ["notes", ...statementKeys].includes(key);
    const editor = (
      <label className="field">
        <span>
          {key === "packagePrice"
            ? "Imported listed online price"
            : `Imported ${label.toLowerCase()}`}
        </span>
        {longText ? (
          <ReviewTextEditor
            value={value}
            onChange={(next) => {
              setEdits((old) => ({ ...old, [key]: next }));
              setReplaceReviewed(false);
            }}
          />
        ) : (
          <input
            type={
              [
                "purchaseQuantity",
                "amountPerPackage",
                "packCount",
                "packagePrice",
              ].includes(key)
                ? "number"
                : "text"
            }
            min={
              [
                "purchaseQuantity",
                "amountPerPackage",
                "packCount",
                "packagePrice",
              ].includes(key)
                ? 0
                : undefined
            }
            step={key === "packCount" ? "1" : "any"}
            value={value}
            onChange={(e) =>
              setEdits((old) => ({ ...old, [key]: e.target.value }))
            }
          />
        )}
      </label>
    );
    const current = draft[key];
    const conflict =
      importValuePresent(current) && String(current) !== String(value);
    return (
      <li className="product-import-field" data-wide={longText} key={key}>
        <input
          type="checkbox"
          id={`${reviewId}-${key}`}
          aria-label={label}
          checked={selected.includes(key)}
          disabled={
            (key === "vendor" && !vendorChoice) || !importValuePresent(value)
          }
          onChange={(e) =>
            setSelected((old) =>
              e.target.checked ? [...old, key] : old.filter((k) => k !== key),
            )
          }
        />
        <div className="product-import-value">
          <div>
            <label htmlFor={`${reviewId}-${key}`}>
              <strong>{label}:</strong>
            </label>{" "}
            <ReviewText
              text={reviewValue(
                key,
                value,
                String(product?.fields.currency || draft.currency || "USD"),
              )}
            />
          </div>
          {conflict && (
            <p className="product-import-current">
              Current: <ReviewText text={String(current)} />{" "}
              <span>— select to replace</span>
            </p>
          )}
          {key === "vendor" ? (
            <details className="product-import-edit">
              <summary>Choose vendor</summary>
              <ProductVendorReview
                key={`${index}:${product?.sourceUrl}`}
                name={String(source?.fields.vendor || "")}
                sourceUrl={product!.sourceUrl}
                choice={vendorChoice}
                onChoose={(vendor) => {
                  setVendorChoice(vendor);
                  if (!vendor)
                    setSelected((old) =>
                      old.filter((value) => value !== "vendor"),
                    );
                  else if (
                    (!draft.vendorId && !importValuePresent(draft.vendor)) ||
                    (draft.vendorId === vendor.id &&
                      draft.vendor === vendor.name)
                  )
                    setSelected((old) => [...new Set([...old, "vendor"])]);
                }}
                allowCreate={false}
                onVendorsChange={onVendorsChange}
              />
            </details>
          ) : (
            <details className="product-import-edit">
              <summary>
                {key === "notes"
                  ? "Expand/Edit description"
                  : `Edit ${label.toLowerCase()}`}
              </summary>
              {editor}
            </details>
          )}
          {key === "purchaseQuantity" && !source?.fields.purchaseQuantity && (
            <p className="product-import-missing">
              Review package quantity and unit
              {source?.fields.packageSize
                ? ` from “${source.fields.packageSize}”`
                : ""}
              . No multipack total is assumed.
            </p>
          )}
          {statementKeys.includes(key) && draft.reviewed && draft[key] && (
            <p>
              Existing reviewed wording is kept unless replacement is confirmed
              below.
            </p>
          )}
        </div>
      </li>
    );
  }
  const pasteFields = (
    <>
      {pasting && (
        <div>
          <label className="field">
            <span>Product text / notes</span>
            <textarea
              rows={4}
              aria-label="Product text / notes"
              maxLength={6000}
              value={draft.notes || ""}
              onChange={(e) => apply({ notes: e.target.value })}
            />
            <small>
              Pasted text is kept as notes. Enter name, package quantity, unit
              and price in the form below, then save. Keep this page open until
              saved.
            </small>
          </label>
          {lookupPanel && (
            <ItemPhotoField
              value={{
                id: "product-screenshot",
                name: "Product screenshot",
                imageAssetId: screenshotId,
              }}
              assets={screenshotAssets}
              kind="product"
              uploadLabel="Upload product screenshot"
              showPhotoPicker={false}
              disabled={busy}
              onChange={(_key, value) => setScreenshotId(value)}
              onWorkspace={(workspace) => {
                setScreenshotAssets(workspace.graphic_assets || []);
                onWorkspace(workspace);
              }}
              onBusy={setUploadingScreenshot}
            >
              <small>Reference image only. Enter its details manually.</small>
            </ItemPhotoField>
          )}
        </div>
      )}
    </>
  );
  return (
    <section
      className={`product-link-panel product-import${compact ? " product-import-compact" : ""}${lookupPanel ? " find-product-panel" : ""}`}
      aria-label="Import from product link"
    >
      {!compact && (
        <strong>
          {lookupPanel
            ? "Find product details"
            : "Have a product link? Fill details from a store page."}
        </strong>
      )}
      <div className="product-link-entry">
        <label className="field">
          <span>Product URL</span>
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            value={url}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value);
              setError("");
              setDiagnostics(null);
              setRetryAt(0);
              setAttempts({ url: "", count: 0 });
            }}
            placeholder="https://…"
          />
        </label>
        <button
          type="button"
          className="btn secondary"
          disabled={
            busy ||
            uploadingScreenshot ||
            !url.trim() ||
            (!lookupPanel && verificationUrls.includes(url.trim())) ||
            (attempts.url === url.trim() &&
              ((!lookupPanel && attempts.count >= 3) || clock < retryAt))
          }
          ref={reviewReturnFocus}
          onClick={search}
        >
          {busy ? "Getting product details…" : "Import details"}
        </button>
      </div>
      {lookupPanel && lookupAction === "url" && error && (
        <div>
          <LookupError
            message={error}
            code={errorCode}
            status={errorStatus}
            diagnostics={diagnostics}
          >
            {clock < retryAt && (
              <p>Retry with Import details after the source wait period.</p>
            )}
          </LookupError>
          <div className="button-row">
            <button
              type="button"
              className="btn secondary"
              onClick={search}
              disabled={
                busy ||
                uploadingScreenshot ||
                clock < retryAt ||
                errorCode === "PRODUCT_HUMAN_VERIFICATION"
              }
            >
              Retry
            </button>
            <button
              type="button"
              className="text-button"
              onClick={(e) =>
                e.currentTarget
                  .closest("form")
                  ?.querySelector<HTMLInputElement>("[data-item-name]")
                  ?.focus()
              }
            >
              Enter details manually
            </button>
          </div>
        </div>
      )}
      <LookupActionContext.Provider
        value={
          lookupPanel
            ? {
                active: lookupAction,
                start: (action) => {
                  setLookupAction(action);
                  setError("");
                  setDiagnostics(null);
                },
              }
            : null
        }
      >
        {typeof afterLookup === "function"
          ? afterLookup((value) => {
              setUrl(value);
              setError("");
              setDiagnostics(null);
              setRetryAt(0);
              setAttempts({ url: "", count: 0 });
            })
          : afterLookup}
      </LookupActionContext.Provider>
      {!afterLookup && (
        <p className="muted">
          Use Share → Copy link on the Amazon product page.
          {!compact &&
            " Some retailers restrict access; manual entry stays available."}
        </p>
      )}
      {busy && <p role="status">Reading product details…</p>}
      {!lookupPanel && error && (
        <div className="product-import-error-actions">
          <FormErrorNotice message={error} />
          {!verificationUrl && (
            <button
              type="button"
              className="btn secondary"
              onClick={search}
              disabled={
                busy ||
                uploadingScreenshot ||
                (attempts.url === url.trim() &&
                  ((!lookupPanel && attempts.count >= 3) || clock < retryAt))
              }
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className="text-button"
            onClick={(e) =>
              e.currentTarget
                .closest("form")
                ?.querySelector<HTMLInputElement>("[data-item-name]")
                ?.focus()
            }
          >
            Enter details manually
          </button>
          {attempts.count >= 3 ? (
            <p className="form-hint">
              Retry limit reached. Continue manually, or reopen the importer
              later.
            </p>
          ) : (
            clock < retryAt && (
              <p role="status" className="form-hint">
                Retry available{" "}
                {Number.isFinite(retryAt)
                  ? new Date(retryAt).toLocaleTimeString()
                  : "after the source wait period"}
                .
              </p>
            )
          )}
          <a href="/support">Contact support</a>
        </div>
      )}
      {!lookupPanel && (verificationUrl || error) && (
        <ManualReference className="product-import-review">
          {compact && packaging && (
            <summary>Reference screenshot (optional)</summary>
          )}
          <p>
            Continue here with pasted product text, a screenshot for reference,
            or manual entry below. Review all values before saving.
            {verificationUrl &&
              " Browser verification does not resume this import."}
          </p>
          <ItemPhotoField
            value={{
              id: "product-screenshot",
              name: "Product screenshot",
              imageAssetId: screenshotId,
            }}
            assets={screenshotAssets}
            kind="product"
            uploadLabel="Upload product screenshot"
            showPhotoPicker={false}
            disabled={busy}
            onChange={(_key, value) => setScreenshotId(value)}
            onWorkspace={(workspace) => {
              setScreenshotAssets(workspace.graphic_assets || []);
              onWorkspace(workspace);
            }}
            onBusy={setUploadingScreenshot}
          >
            {screenshot?.fileUrl && (
              <a
                href={screenshot.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View uploaded screenshot
              </a>
            )}
            <small>
              PNG, JPEG or WebP, up to 5 MB. The screenshot stays in your image
              library for reference. Enter its details in the form; uploading
              does not extract values or replace your product photo.
            </small>
          </ItemPhotoField>
        </ManualReference>
      )}
      {lookupPanel ? (
        <details
          className="product-paste-action"
          open={pasting}
          onToggle={(e) => setPasting(e.currentTarget.open)}
        >
          <summary>Paste product text</summary>
          {pasteFields}
        </details>
      ) : (
        <>
          <button
            type="button"
            className="text-button"
            aria-expanded={pasting}
            onClick={() => setPasting(!pasting)}
          >
            Paste product text instead
          </button>
          {pasteFields}
        </>
      )}
      {(populateDraft ? importNotice : applied) && (
        <p role="status" className="product-import-applied">
          {populateDraft ? (
            importNotice
          ) : (
            <>
              Selected details applied to this form; {itemWord} not saved yet.
            </>
          )}
        </p>
      )}
      <Dialog
        open={products.length > 0}
        onOpenChange={(open) => {
          if (!open && !busy) cancelReview();
        }}
      >
        <DialogContent
          className="product-import url-import-modal"
          positioning="css"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() =>
              reviewReturnFocus.current?.focus({ preventScroll: true }),
            );
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) cancelReview();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <header>
            <DialogTitle>Review imported information</DialogTitle>
            <DialogDescription>
              Review the source and select fields to use in your unsaved draft.
              Nothing is saved or received here.
            </DialogDescription>
          </header>
          <div className="url-import-scroll">
            {unavailable.length > 0 && (
              <p className="product-import-missing" role="status">
                Not available from source:{" "}
                {unavailable.map((key) => importLabels[key] || key).join(", ")}.
                Existing values are kept; review the package or enter these
                manually.
              </p>
            )}
            {products.length > 0 && offerNotice && (
              <p role="status" className="form-hint">
                {offerNotice}
              </p>
            )}
            {products.length > 0 && (products.length > 1 || offerNotice) && (
              <label className="field">
                <span>Choose the exact product / package / offer</span>
                <select
                  value={index}
                  onChange={(e) => {
                    setIndex(Number(e.target.value));
                    preselectEmptyFields(products[Number(e.target.value)]);
                    setConfirmed(false);
                    setConditionalPriceConfirmed(false);
                    setImageFailed(false);
                    setEdits({});
                    setVendorChoice(null);
                    setReplaceReviewed(false);
                    setCopied(false);
                  }}
                >
                  <option value={-1}>Select a variant</option>
                  {products.map((p, n) => (
                    <option key={n} value={n}>
                      {p.title} ·{" "}
                      {p.fields.purchaseQuantity != null &&
                      p.fields.purchaseUnit
                        ? `${p.fields.purchaseQuantity} ${p.fields.purchaseUnit}`
                        : p.fields.packageSize || "Package not provided"}
                      {p.fields.packCount != null
                        ? ` · ${p.fields.packCount} pack`
                        : ""}{" "}
                      · {p.fields.packagePrice ?? "Price not provided"}{" "}
                      {p.fields.currency} · {p.conditions.join(" · ")}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {product && product.conditions.length > 0 && (
              <p className="form-hint">
                Selected offer: {product.conditions.join(" · ")}
              </p>
            )}
            {populateDraft && products.length > 0 && !product && (
              <p role="status">
                No information has been applied. Choose the exact fulfillment
                offer to review its price and remaining fields.
                {commonImportFields(products).packagePrice === undefined &&
                  " Package price differs or is unavailable; no price was chosen."}
              </p>
            )}
            {product && (
              <div className="product-import-review">
                <div className="product-import-summary">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={`Source product: ${product.title}`}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.hidden = true;
                        setImageFailed(true);
                      }}
                    />
                  ) : (
                    <span>No source image</span>
                  )}
                  <div>
                    <h4>{product.title}</h4>
                    <p>{new URL(product.sourceUrl).hostname}</p>
                    <p className="product-import-visible-url">
                      <a
                        href={product.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {product.sourceUrl}
                      </a>
                    </p>
                    <p>
                      Package:{" "}
                      {product.fields.amountPerPackage != null
                        ? `1 ${product.fields.purchaseUnit || "purchase unit"} = ${product.fields.amountPerPackage} ${product.fields.unit || "— confirm stock unit"}`
                        : `${source?.fields.purchaseQuantity ?? "Quantity unavailable"} ${source?.fields.purchaseUnit ?? "— confirm unit"}`}
                    </p>
                    {product.fields.packCount !== undefined && (
                      <p>Pack count: {product.fields.packCount}</p>
                    )}
                    <p>
                      Source image preview. No image asset is saved by accepting
                      this review.
                    </p>
                  </div>
                </div>
                <p role="status">
                  {product.warnings.length
                    ? "Partial details available. Check uncertain values and fill missing fields manually."
                    : "Details ready for review."}{" "}
                  {populateDraft
                    ? "Select fields to use. Existing entries change only with your approval."
                    : "Existing entries change only when you select and apply a field."}
                </p>
                {imageFailed && (
                  <p>
                    Source thumbnail unavailable. Manual photo upload is
                    available in the editor.
                  </p>
                )}
                {product.fields.packagePrice === undefined && (
                  <p className="product-import-missing">
                    Price unavailable—enter manually. The retrieved source does
                    not expose a usable package price; any current price is
                    preserved.
                    {draft.inventoryCreation ? (
                      "Cost and quantity are optional when saving item details alone. Confirm actual cost when recording stock."
                    ) : (
                      <>
                        Package quantity and total price are required before
                        Save {itemWord}; enter zero only for a free purchase.
                      </>
                    )}
                  </p>
                )}
                {!product.fields.name && (
                  <p className="product-import-missing">
                    Product name unavailable—enter manually.
                  </p>
                )}
                {!product.fields.brand && (
                  <p className="product-import-missing">
                    Brand unavailable—enter manually if needed.
                  </p>
                )}
                {populateDraft &&
                  (!source?.fields.purchaseQuantity ||
                    !source.fields.purchaseUnit) && (
                    <p className="product-import-missing">
                      Package amount or unit not available from this source;
                      enter it manually. Existing package details are kept.
                    </p>
                  )}
                {!product.fields.currency && (
                  <p className="product-import-missing">
                    Currency unavailable—confirm manually.
                  </p>
                )}
                {populateDraft &&
                  food &&
                  statementKeys
                    .filter((key) => !product.fields[key])
                    .map((key) => (
                      <p className="product-import-missing" key={key}>
                        {importLabels[key]} not available from this source;
                        existing wording is kept.
                      </p>
                    ))}
                {populateDraft &&
                  packageSetup &&
                  source?.fields.purchaseQuantity != null && (
                    <p className="product-import-package-note">
                      Source package: {source.fields.purchaseQuantity}{" "}
                      {source.fields.purchaseUnit}.
                      {product.fields.amountPerPackage != null
                        ? ` Amount in each package: ${precise(Number(product.fields.amountPerPackage))} ${draft.unit}. Purchase unit uses “package” unless you entered a package type.`
                        : " A verified conversion to the stock unit is needed; enter the package amount manually."}
                    </p>
                  )}
                {product.fields.purchaseQuantity !== undefined && (
                  <p className="product-import-package-note">
                    Confirm quantity and unit against the package
                    {product.fields.packCount === undefined
                      ? "; pack count was not provided"
                      : ""}
                    .
                  </p>
                )}
                <div className="product-import-selection">
                  <span>Select values to apply</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setSelected(
                        Object.entries(availableFields)
                          .filter(
                            ([key, value]) =>
                              key !== "packageSize" &&
                              importValuePresent(value) &&
                              (key !== "vendor" || vendorChoice),
                          )
                          .map(([key]) => key),
                      );
                      setConfirmed(packageProposed);
                    }}
                  >
                    Select all
                  </button>
                  <span aria-hidden="true">/</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setSelected([]);
                      setConfirmed(false);
                    }}
                  >
                    Clear selection
                  </button>
                </div>
                <ul
                  className="product-import-fields"
                  aria-label="Imported values"
                >
                  {Object.entries(availableFields)
                    .filter(([key]) => key !== "packageSize")
                    .map(([key, value]) => renderField(key, value))}
                </ul>
                {food && (
                  <p>
                    Check ingredient and allergen wording against the package.
                    Importing does not mark it reviewed.
                  </p>
                )}
                <div className="product-import-source-summary">
                  <span>
                    {product.fields.vendor ||
                      new URL(product.sourceUrl).hostname}
                  </span>
                  <span>
                    Listed online price checked{" "}
                    {ovenTimestamp(product.checkedAt, settings)}
                  </span>
                  <a
                    href={product.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View product
                  </a>
                </div>
                <details className="product-import-details">
                  <summary>Source details</summary>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          product.requestedUrl || product.sourceUrl,
                        );
                        setCopied(true);
                      } catch {
                        setError(
                          "Could not copy the source URL. Use View product and copy the address from your browser.",
                        );
                      }
                    }}
                  >
                    Copy source URL
                  </button>
                  {copied && <span role="status">Source URL copied.</span>}
                  <p>
                    Listed online price is not a purchase receipt. Confirm the
                    amount paid; tax and shipping are not inferred.
                  </p>
                  {[...new Set(product.warnings.concat(product.conditions))]
                    .filter(
                      (warning) =>
                        !/retrieved source did not expose|package quantity was read|Package size needs checking/i.test(
                          warning,
                        ),
                    )
                    .map((warning, n) => (
                      <p key={n}>{warning}</p>
                    ))}
                </details>
                {packageProposed && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I approve changing the current package reference when I
                    save. Future estimates may change; stock valuation and
                    historical batches stay unchanged.
                  </label>
                )}
                {replacesReviewed && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={replaceReviewed}
                      onChange={(e) => setReplaceReviewed(e.target.checked)}
                    />
                    Replace existing reviewed ingredient/allergen wording with
                    the selected text and require a new review.
                  </label>
                )}
                {conditionalPrice && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={conditionalPriceConfirmed}
                      onChange={(event) =>
                        setConditionalPriceConfirmed(event.target.checked)
                      }
                    />
                    I confirm this membership or subscription price applies to
                    my selected package. It is not a standard one-time price.
                  </label>
                )}
                <p>{calculation}</p>
              </div>
            )}
          </div>
          <footer className="product-import-footer">
            <FormErrorNotice message={error} />
            {discardReview && (
              <div role="alert" className="form-error-notice">
                <p>Discard corrections made in this review?</p>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setDiscardReview(false);
                  }}
                >
                  Keep reviewing
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={clearReview}
                >
                  Discard import
                </button>
              </div>
            )}
            <p aria-live="polite">
              {applicableSelected.length} fields selected.
            </p>
            <p>
              Acceptance fills the unsaved form. Save {itemWord} stores
              your changes.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="btn"
                disabled={
                  !product ||
                  busy ||
                  (replacesReviewed && !replaceReviewed) ||
                  (selected.includes("vendor") && !vendorChoice) ||
                  !applicableSelected.length ||
                  (packageSelected && !confirmed) ||
                  (conditionalPrice && !conditionalPriceConfirmed)
                }
                onClick={commit}
              >
                Accept &amp; use information
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={cancelReview}
              >
                Cancel
              </button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>
    </section>
  );
}
