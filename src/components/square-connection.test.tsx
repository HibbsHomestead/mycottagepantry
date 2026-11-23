import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SquareConnection } from "./square-connection";
afterEach(() => vi.unstubAllGlobals());
it("keeps operator controls and sales preview out of an unconfigured customer screen", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      view: {
        configured: false,
        status: "not_connected",
        environment: "production",
      },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<SquareConnection allowed initiallyOpen onReview={vi.fn()} />);
  await screen.findByText(
    "Square connection is not available yet. Contact support.",
  );
  expect(
    screen.queryByRole("button", { name: "Connect / manage Square" }),
  ).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByLabelText("Start (UTC, inclusive)")).toBeNull();
  expect(screen.getByRole("button", { name: "Connect Square" })).toBeDisabled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("requires saved locations before preview and sends explicit UTC inputs without importing", async () => {
  const user = userEvent.setup();
  const view = {
    configured: true,
    status: "connected",
    merchantId: "fictional-merchant",
    environment: "production",
    locations: [
      {
        id: "market",
        name: "Fictional market",
        timezone: "UTC",
        currency: "USD",
      },
    ],
    selectedLocations: [] as string[],
  };
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    const action = options?.body ? JSON.parse(String(options.body)).action : "";
    if (action === "locations") view.selectedLocations = ["market"];
    return Response.json({
      view,
      ...(action === "sample" ? { sample: { count: 1 } } : {}),
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const review = vi.fn();
  render(<SquareConnection allowed initiallyOpen onReview={review} />);
  await screen.findByText(/fictional-merchant/);
  expect(screen.queryByRole("button", { name: "Preview sales" })).toBeNull();
  await user.click(screen.getByLabelText(/Fictional market/));
  await user.click(
    screen.getByRole("button", { name: "Save locations & verify access" }),
  );
  await user.type(
    await screen.findByLabelText("Start (UTC, inclusive)"),
    "2026-11-01T09:30",
  );
  await user.type(
    screen.getByLabelText("End (UTC, exclusive)"),
    "2026-11-02T09:30",
  );
  await user.click(screen.getByRole("button", { name: "Preview sales" }));
  expect(review).toHaveBeenCalledWith({ count: 1 }, "production");
  const last = fetcher.mock.calls.at(-1)!;
  expect(last[0]).toBe("/api/square-sales");
  expect(JSON.parse(String(last[1]?.body))).toMatchObject({
    action: "sample",
    startLocal: "2026-11-01T09:30",
    endLocal: "2026-11-02T09:30",
  });
  expect(
    fetcher.mock.calls.every(([url]) => !url.includes("/api/workspace")),
  ).toBe(true);
});
