const { chromium } = require("playwright");
const { mkdirSync } = require("node:fs");
mkdirSync("test-artifacts", { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.CHROMIUM_EXECUTABLE,
          args: [
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--no-zygote",
            "--single-process",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:8081");
  await page
    .getByRole("heading", { name: "Welcome to your workspace" })
    .waitFor();
  await page.screenshot({ path: "test-artifacts/teamspace-login.png" });
  await page.getByLabel("Username", { exact: true }).fill("ayman");
  await page
    .getByLabel("Password or app password", { exact: true })
    .fill("test-app-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Details for Project brief.pdf", exact: true })
    .waitFor();
  await page.screenshot({ path: "test-artifacts/teamspace-dashboard.png" });
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Browser test");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Details for Browser test", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /^Browser test Can edit/ }).click();
  await page.getByText("A fresh space for your work").waitFor();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "Test upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Browser upload test"),
    });
  await page
    .getByRole("button", { name: "Details for Test upload.txt", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Details for Test upload.txt", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  if (download.suggestedFilename() !== "Test upload.txt")
    throw new Error("Wrong download filename");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Renamed.txt");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Details for Renamed.txt", exact: true })
    .waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "All files", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Details for Project brief.pdf", exact: true })
    .click();
  await page.getByRole("button", { name: "Versions", exact: true }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).waitFor();
  await page.screenshot({ path: "test-artifacts/teamspace-versions.png" });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByText("Version restored", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Sharing", exact: true }).click();
  await page.getByLabel("User or group", { exact: true }).fill("Meshal");
  await page.getByRole("button", { name: /Meshal/ }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByLabel("Permission for meshal", { exact: true }).waitFor();
  await page
    .getByLabel("Permission for meshal", { exact: true })
    .selectOption("edit");
  await page.getByText("Permission updated", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("meshal");
  await page
    .getByLabel("Password or app password", { exact: true })
    .fill("test-app-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Details for Project brief.pdf", exact: true })
    .click();
  if (
    await page.getByRole("button", { name: "Delete", exact: true }).isEnabled()
  )
    throw new Error("Read-only delete enabled");
  if (
    await page
      .getByRole("button", { name: "Upload files", exact: true })
      .isEnabled()
  )
    throw new Error("Read-only upload enabled");
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-artifacts/teamspace-mobile.png" });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
  ) {
    console.log(
      await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter(
            (e) => e.getBoundingClientRect().right > window.innerWidth + 1,
          )
          .map((e) => ({
            tag: e.tagName,
            cls: e.className,
            right: e.getBoundingClientRect().right,
          }))
          .slice(0, 20),
      ),
    );
    throw new Error("Mobile page overflows horizontally");
  }
  console.log(
    JSON.stringify({
      browserFlows:
        "login, folder creation, upload, download, rename, versions, sharing, permission update, logout, read-only controls, mobile",
      errors,
    }),
  );
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
