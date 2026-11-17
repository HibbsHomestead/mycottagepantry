import { render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CoverBackground } from "./cover-background";

afterEach(() => window.history.replaceState({}, "", "/"));

it("shows the approved artwork for ordinary Inventory and removes it when leaving", () => {
  window.history.replaceState({}, "", "/oven#Inventory/Ingredients");
  const { container, rerender } = render(<CoverBackground inventory />);
  expect(container.querySelector(".cover-background")).not.toBeNull();
  rerender(<CoverBackground />);
  expect(container.querySelector(".cover-background")).toBeNull();
});

it("keeps unrelated ordinary pages free of artwork", () => {
  window.history.replaceState({}, "", "/oven#Finance");
  const { container } = render(<CoverBackground />);
  expect(container.querySelector(".cover-background")).toBeNull();
});

it("reuses the root preview artwork without adding a duplicate on Inventory", () => {
  window.history.replaceState(
    {},
    "",
    "/oven?cover-preview=1#Inventory/Ingredients",
  );
  const { container } = render(
    <>
      <CoverBackground />
      <CoverBackground inventory />
    </>,
  );
  expect(container.querySelectorAll(".cover-background")).toHaveLength(1);
});
