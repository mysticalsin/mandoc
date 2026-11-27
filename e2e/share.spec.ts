import { expect, test, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Code")).toHaveValue(/\d{6}/);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
}

test("share, verify, view, and blocked links", async ({ page, browser }) => {
  await signIn(page, "ada@example.com");
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([320, 200]);
  sheet.drawText("Mandoc sample", { x: 40, y: 100, size: 18, font: await pdf.embedFont(StandardFonts.Helvetica) });
  await page.locator("input[type=file]").setInputFiles({
    name: "note.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByRole("link", { name: /note\.pdf/ })).toBeVisible();

  const office = zipSync({
    "xl/sharedStrings.xml": strToU8("<sst><si><t>Revenue</t></si></sst>"),
    "xl/worksheets/sheet1.xml": strToU8('<sheetData><c t="s"><v>0</v></c></sheetData>'),
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "figures.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(office),
  });
  await expect(page.getByRole("link", { name: /figures\.xlsx/ })).toBeVisible();

  await page.getByRole("link", { name: /note\.pdf/ }).click();
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByLabel("Recipients").fill("viewer@example.com");
  await page.getByRole("button", { name: "Create" }).click();
  const link = await page.getByLabel("Link").inputValue();

  const viewer = await browser.newPage();
  await viewer.goto(link);
  await viewer.getByLabel("Email").fill("viewer@example.com");
  await viewer.getByRole("button", { name: "Continue" }).click();
  await expect(viewer.getByLabel("Code")).toHaveValue(/\d{6}/);
  const realCode = await viewer.getByLabel("Code").inputValue();
  const wrongCode = realCode === "000000" ? "000001" : "000000";
  await viewer.getByLabel("Code").fill(wrongCode);
  await viewer.getByRole("button", { name: "Sign in" }).click();
  await expect(viewer.getByText("Invalid or expired code")).toBeVisible();
  await viewer.getByLabel("Code").fill(realCode);
  const viewed = viewer.waitForResponse((response) => response.url().includes("/api/view/") && response.status() === 200);
  await viewer.getByRole("button", { name: "Sign in" }).click();
  expect((await viewed).headers()["content-type"]).toContain("application/pdf");
  await expect(viewer.getByRole("heading", { name: "note.pdf" })).toBeVisible();

  await page.getByRole("button", { name: "Revoke" }).click();
  await viewer.reload();
  await expect(viewer.getByRole("heading", { name: "Not found" })).toBeVisible();
  await viewer.goto("/s/not-a-real-token-value");
  await expect(viewer.getByRole("heading", { name: "Not found" })).toBeVisible();
});

test("a member cannot open admin", async ({ page }) => {
  await signIn(page, "bea@example.com");
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});
