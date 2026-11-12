import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BarcodeScanner } from "./barcode-scanner";
type DecodeCallback = (result: {
  getText: () => string;
  getBarcodeFormat: () => number;
}) => void;
type FakeStream = { getTracks: () => { stop: () => void }[] };
const reader = vi.hoisted(() => ({
  callback: undefined as unknown as DecodeCallback,
  stop: vi.fn(),
}));
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    async decodeFromStream(
      _stream: MediaStream,
      _video: HTMLVideoElement,
      callback: DecodeCallback,
    ) {
      reader.callback = callback;
      return { stop: reader.stop };
    }
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reader.callback = undefined as unknown as DecodeCallback;
  reader.stop.mockClear();
});
it("keeps manual entry usable after camera permission denial and never navigates scanned URLs", async () => {
  const onCode = vi.fn();
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockRejectedValue({ name: "NotAllowedError" }),
    },
  });
  render(<BarcodeScanner onCode={onCode} onClose={vi.fn()} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Start rear camera" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Camera permission was denied",
  );
  await userEvent.type(screen.getByRole("textbox"), "001234567890");
  await userEvent.click(
    screen.getByRole("button", { name: "Use entered code" }),
  );
  expect(onCode).toHaveBeenCalledWith("001234567890", undefined);
});
it("stops tracks after the first detection, ignores repeated detections and cleans up on close", async () => {
  const stop = vi.fn(),
    onCode = vi.fn(),
    stream = { getTracks: () => [{ stop }] };
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("BarcodeDetector", undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  const view = render(<BarcodeScanner onCode={onCode} onClose={vi.fn()} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Start rear camera" }),
  );
  await waitFor(() => expect(reader.callback).toBeTypeOf("function"));
  reader.callback({
    getText: () => "036000291452",
    getBarcodeFormat: () => 14,
  });
  reader.callback({
    getText: () => "036000291452",
    getBarcodeFormat: () => 14,
  });
  expect(onCode).toHaveBeenCalledTimes(1);
  expect(onCode).toHaveBeenCalledWith("036000291452", "upc_a");
  expect(stop).toHaveBeenCalled();
  view.unmount();
  expect(reader.stop).toHaveBeenCalled();
});
it("releases a camera stream that arrives after the dialog unmounts", async () => {
  let resolve!: (value: FakeStream) => void;
  const stop = vi.fn();
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  });
  const view = render(<BarcodeScanner onCode={vi.fn()} onClose={vi.fn()} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Start rear camera" }),
  );
  view.unmount();
  resolve({ getTracks: () => [{ stop }] });
  await waitFor(() => expect(stop).toHaveBeenCalled());
});
it("does not request on render, rerender or duplicate starts; Retry is intentional", async () => {
  const stop = vi.fn();
  let resolve!: (value: FakeStream) => void;
  const request = vi
    .fn()
    .mockRejectedValueOnce({ name: "NotAllowedError" })
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  vi.stubGlobal("isSecureContext", true);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: request },
  });
  const view = render(<BarcodeScanner onCode={vi.fn()} onClose={vi.fn()} />);
  expect(request).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Start rear camera" }),
  );
  await screen.findByRole("alert");
  expect(request).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Retry camera" }));
  view.rerender(<BarcodeScanner onCode={vi.fn()} onClose={vi.fn()} />);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });
  resolve({ getTracks: () => [{ stop }] });
  await waitFor(() => expect(reader.callback).toBeTypeOf("function"));
  view.unmount();
  expect(stop).toHaveBeenCalled();
});
it("continuous mode counts a held barcode once, supports explicit identical-package rearming, and keeps camera until pause", async () => {
  const stop = vi.fn(),
    onCode = vi.fn();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("BarcodeDetector", undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    },
  });
  render(<BarcodeScanner continuous onCode={onCode} onClose={vi.fn()} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Start rear camera" }),
  );
  await waitFor(() => expect(reader.callback).toBeTypeOf("function"));
  const code = { getText: () => "000123", getBarcodeFormat: () => 4 };
  for (let i = 0; i < 8; i++) reader.callback(code);
  expect(onCode).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Count another identical package" }),
  );
  reader.callback(code);
  reader.callback(code);
  expect(onCode).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole("button", { name: "Pause camera" }));
  expect(stop).toHaveBeenCalled();
});
it("continuous manual/external Enter submissions accept identical intentional events once each without reinitializing the camera", async () => {
  const onCode = vi.fn();
  render(<BarcodeScanner continuous onCode={onCode} onClose={vi.fn()} />);
  const input = screen.getByRole("textbox");
  await userEvent.type(input, "000123{Enter}{Enter}");
  expect(onCode).toHaveBeenCalledTimes(1);
  await userEvent.type(input, "000123{Enter}");
  expect(onCode).toHaveBeenCalledTimes(2);
  expect(input).toHaveValue("");
});
