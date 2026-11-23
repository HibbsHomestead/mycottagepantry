import { useState } from "react";
import type { Workspace } from "@/lib/domain";
import { parseSquare } from "@/lib/square-sales";
import { SquareConnection } from "./square-connection";
import { FormErrorNotice } from "./form-error-notice";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import "./square-sales-import.css";

export function SquareIntegration({
  allowed,
  onWorkspace,
}: {
  allowed: boolean;
  onWorkspace: (w: Workspace) => void;
}) {
  const [review, setReview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const parsed = review ? parseSquare(review.csv, review.options) : null;
  async function importReviewed() {
    if (!confirmed || !review || !allowed) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "squareApiImport",
          table: "sales_imports",
          data: {
            proof: review.proof,
            environment: review.environment,
            confirm: true,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Import failed. Retry the reviewed sample safely.",
        );
      onWorkspace(result.workspace);
      setReview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Square integration">
      <SquareConnection
        allowed={allowed}
        initiallyOpen
        onReview={(sample, environment) => {
          setReview({ ...sample, environment });
          setConfirmed(false);
          setError("");
        }}
      />
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogContent className="square-import-dialog">
          <DialogTitle>Review Square sales</DialogTitle>
          <DialogDescription>
            Nothing has been imported. These transaction totals do not allocate
            products or move inventory. Confirm only after checking for CSV
            overlap.
          </DialogDescription>
          <p>
            {review?.count} transactions · Merchant {review?.options.account} ·
            UTC · {review?.environment}
          </p>
          <p>
            Existing Square source identifiers are reconciled with CSV imports.
            CSVs without the same merchant and transaction identifiers cannot
            guarantee overlap detection. Payment, tax and tips remain separate.
            No payments, receipts, inventory movements or journal entries are
            created.
          </p>
          <div className="square-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Location</th>
                  <th>Transaction</th>
                  <th>Sales / tax / tips / payment / fees</th>
                </tr>
              </thead>
              <tbody>
                {parsed?.rows.map((row, index) => (
                  <tr key={index}>
                    <td>{row.date}</td>
                    <td>{row.location}</td>
                    <td>{row.transactionId || row.paymentId || row.orderId}</td>
                    <td>
                      {row.currency}{" "}
                      {["net", "tax", "tips", "payment", "fees"]
                        .map((field) =>
                          row.amounts[field] == null
                            ? "Unknown"
                            : (row.amounts[field]! / 100).toFixed(2),
                        )
                        .join(" / ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed these transactions and resolved any overlap with earlier
            CSV imports.
          </label>
          <FormErrorNotice message={error} />
          <div className="button-row">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </button>
            <button
              className="btn"
              disabled={
                !allowed || !confirmed || busy || !!parsed?.errors.length
              }
              onClick={() => void importReviewed()}
            >
              {busy ? "Importing…" : "Import reviewed sales"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
