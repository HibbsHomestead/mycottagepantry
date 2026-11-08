import {
  ProductImportFailure,
  type ProductImportDiagnostics,
} from './product-import-diagnostics'
import { z } from 'zod'
export const walmartVerificationMessage =
  'Walmart requires human verification. Open the product page in your browser, or add the product details below.'
export class ProductHumanVerificationError extends Error {
  readonly code = 'PRODUCT_HUMAN_VERIFICATION'
  constructor() {
    super(walmartVerificationMessage)
  }
}
const fields = z.object({
  manufacturerSku: z.string().max(6000).optional(),
  materialType: z.string().max(100).optional(),
  fiber: z.string().max(6000).optional(),
  color: z.string().max(6000).optional(),
  pattern: z.string().max(6000).optional(),
  variant: z.string().max(6000).optional(),
  fabricWidth: z.number().positive().optional(),
  widthUnit: z.string().max(20).optional(),
  yarnLength: z.number().positive().optional(),
  yarnLengthUnit: z.string().max(20).optional(),
  yarnWeight: z.number().positive().optional(),
  yarnWeightUnit: z.string().max(20).optional(),
  dimensions: z.string().max(6000).optional(),
  itemsPerPackage: z.number().int().positive().optional(),
  name: z.string().min(1).max(6000).optional(),
  packageSize: z.string().max(200).optional(),
  packCount: z.number().int().positive().optional(),
  brand: z.string().max(6000).optional(),
  vendor: z.string().max(6000).optional(),
  retailerSku: z.string().max(6000).optional(),
  barcode: z
    .string()
    .regex(/^\d{8}$|^\d{12,14}$/)
    .optional(),
  notes: z.string().max(6000).optional(),
  subingredients: z.string().max(6000).optional(),
  sourceContains: z.string().max(6000).optional(),
  sourceMayContain: z.string().max(6000).optional(),
  packagePrice: z.number().finite().nonnegative().optional(),
  currency: z.string().max(10).optional(),
  purchaseQuantity: z.number().finite().positive().optional(),
  purchaseUnit: z.string().max(20).optional(),
})
export const productImportResponse = z.object({
  products: z
    .array(
      z
        .object({
          fields,
          title: z.string().min(1).max(6000),
          imageUrl: z.string().max(8192),
          sourceUrl: z.string().url().max(8192),
          requestedUrl: z.string().url().max(8192).optional(),
          checkedAt: z.string().datetime(),
          warnings: z.array(z.string()),
          conditions: z.array(z.string()),
        })
        .refine(
          (product) =>
            Boolean(product.imageUrl) ||
            Object.keys(product.fields).some(
              (key) => !['vendor', 'currency'].includes(key),
            ),
          'No product fields were provided.',
        ),
    )
    .min(1)
    .max(20),
})
export function productUrl(value: string) {
  const input = value.trim()
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error(
      'Enter a complete product URL beginning with http:// or https://.',
    )
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !parsed.hostname.includes('.') ||
    parsed.username ||
    parsed.password ||
    input.length > 8192
  )
    throw new Error(
      'Enter a complete HTTP or HTTPS product URL without credentials (up to 8,192 characters).',
    )
  // Preserve the original path, identifier and query. The server upgrades HTTP to HTTPS.
  return input
}
export async function readImportResponse(response: Response) {
  const mime = (response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  const text = await response.text()
  if (!['application/json', 'application/problem+json'].includes(mime)) {
    if ([401, 403].includes(response.status))
      throw new Error(
        `Site access or sign-in is required (HTTP ${response.status}). Open Cottage Pantry in another tab, complete the site-access sign-in, then retry here. Your unsaved form stays open.`,
      )
    if (
      response.status === 404 ||
      (response.ok && /<!doctype|<html/i.test(text))
    )
      throw new Error(
        `The product-import API returned a webpage instead of JSON (HTTP ${response.status}). The deployed /api/workspace function or routing needs repair.`,
      )
    throw new Error(
      `The product-import service returned ${text.trim() ? 'a non-JSON response' : 'an empty response'} (HTTP ${response.status}). Retry shortly; if it continues, check the function deployment.`,
    )
  }
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(
      `The product-import service returned invalid or empty JSON (HTTP ${response.status}). Retry shortly; if it continues, check the function logs.`,
    )
  }
  if (!response.ok && data?.code === 'PRODUCT_HUMAN_VERIFICATION')
    throw new ProductHumanVerificationError()
  if (!response.ok && data?.diagnostics && Array.isArray(data.diagnostics.hops))
    throw new ProductImportFailure(
      typeof data.error === 'string'
        ? data.error
        : 'Product details could not be retrieved.',
      data.diagnostics as ProductImportDiagnostics,
      response.headers.get('retry-after') || undefined,
      typeof data.code === 'string' ? data.code : undefined,
      response.status,
    )
  if (!response.ok)
    throw new ProductImportFailure(
      typeof data?.error === 'string'
        ? data.error
        : 'The product-import request failed. Retry or enter details manually.',
      {
        requestedAt: new Date().toISOString(),
        requestedUrl: '',
        source: 'backend',
        hops: [],
      },
      response.headers.get('retry-after') || undefined,
      typeof data?.code === 'string' ? data.code : undefined,
      response.status,
    )
  return data
}
