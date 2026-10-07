// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({
  ready: vi.fn(),
  check: vi.fn(),
  install: vi.fn(async () => {}),
  restart: vi.fn(async () => {}),
  releases: vi.fn(async () => {}),
}));
vi.mock("../lib/api", () => ({
  native: true,
  api: {
    updaterReady: mocks.ready,
    shortcutStatus: async () => null,
    restartApp: mocks.restart,
    openReleases: mocks.releases,
  },
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
import { explainUpdateError, Updates } from "./updates";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("does not contact the update server when signing is not configured", async () => {
  mocks.ready.mockResolvedValue(false);
  const user = userEvent.setup();
  render(<Updates />);
  await user.click(screen.getByText("Quick switch & app updates"));
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  await screen.findByText(/configured for signed updates/);
  expect(mocks.check).not.toHaveBeenCalled();
});
it("shows release notes and installs only after the user clicks Install", async () => {
  mocks.ready.mockResolvedValue(true);
  mocks.check.mockResolvedValue({
    version: "0.2.0",
    body: "New profile colours",
    downloadAndInstall: mocks.install,
    close: async () => {},
  });
  const user = userEvent.setup();
  render(<Updates />);
  await user.click(screen.getByText("Quick switch & app updates"));
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  await screen.findByText("New profile colours");
  expect(mocks.install).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Install update" }));
  await waitFor(() => expect(mocks.install).toHaveBeenCalledTimes(1));
  await screen.findByText(/Update installed/);
  await user.click(screen.getByRole("button", { name: "Restart now" }));
  expect(mocks.restart).toHaveBeenCalledTimes(1);
});

it("retries a failed check once before reporting it", async () => {
  mocks.ready.mockResolvedValue(true);
  mocks.check
    .mockRejectedValueOnce(new Error("error sending request"))
    .mockResolvedValueOnce(null);
  const user = userEvent.setup();
  render(<Updates />);
  await user.click(screen.getByText("Quick switch & app updates"));
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  await screen.findByText("You’re up to date.", {}, { timeout: 4000 });
  expect(mocks.check).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByRole("button", { name: "Download manually" }),
  ).not.toBeInTheDocument();
});

it("explains an unreachable update server and offers the manual download", async () => {
  mocks.ready.mockResolvedValue(true);
  mocks.check.mockRejectedValue(new Error("error sending request for url"));
  const user = userEvent.setup();
  render(<Updates />);
  await user.click(screen.getByText("Quick switch & app updates"));
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  await screen.findByText(
    /Could not check for updates.*internet connection.*error sending request/,
    {},
    { timeout: 4000 },
  );
  await user.click(screen.getByRole("button", { name: "Download manually" }));
  expect(mocks.releases).toHaveBeenCalledTimes(1);
});

it("turns install-location and permission errors into next steps", () => {
  expect(
    explainUpdateError(new Error("Read-only file system (os error 30)")),
  ).toMatch(/Applications folder/);
  expect(explainUpdateError("Failed to move the new app into place")).toMatch(
    /administrator prompt/,
  );
  expect(explainUpdateError("something unexpected")).toBe(
    "something unexpected",
  );
});

it("keeps installation successful when resource cleanup fails", async () => {
  mocks.ready.mockResolvedValue(true);
  mocks.check.mockResolvedValue({
    version: "0.2.0", body: "Fix cleanup",
    downloadAndInstall: mocks.install,
    close: vi.fn().mockRejectedValue(new Error("Command plugin:resources|close not allowed by ACL")),
  });
  const user = userEvent.setup();
  render(<Updates />);
  await user.click(screen.getByText("Quick switch & app updates"));
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  await screen.findByText("Fix cleanup");
  await user.click(screen.getByRole("button", { name: "Install update" }));
  await screen.findByText(/Update installed/);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Install update" })).not.toBeInTheDocument());
  expect(screen.queryByText(/Update failed/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  expect(mocks.check).toHaveBeenCalledTimes(1);
});

it("reports actual installation failures and permits retry", async () => {
  mocks.ready.mockResolvedValue(true);
  mocks.install.mockRejectedValueOnce(new Error("Signature verification failed"));
  mocks.check.mockResolvedValue({version: "0.2.0", downloadAndInstall: mocks.install, close: async () => {}});
  const user = userEvent.setup();
  render(<Updates />);
  await user.click(screen.getByText("Quick switch & app updates"));
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  await user.click(await screen.findByRole("button", { name: "Install update" }));
  await screen.findByText(/Update failed.*Signature verification failed/);
  await user.click(screen.getByRole("button", { name: "Install update" }));
  await screen.findByText(/Update installed/);
});

it("can replace and unmount an update whose cleanup rejects", async () => {
  mocks.ready.mockResolvedValue(true);
  const close = vi.fn().mockRejectedValue(new Error("cleanup failed"));
  mocks.check.mockResolvedValue({version: "0.2.0", close});
  const user = userEvent.setup();
  const view = render(<Updates />);
  await user.click(screen.getByText("Quick switch & app updates"));
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  await screen.findByText("Version 0.2.0 is available");
  mocks.check.mockResolvedValue({version: "0.3.0", close});
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  await screen.findByText("Version 0.3.0 is available");
  view.unmount();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
});
