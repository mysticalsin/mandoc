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

test("previews docx, pptx, and xlsx in the browser", async ({ page, browser }) => {
  await signIn(page, "ada@example.com");
  const files = [
    {
      name: "brief.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from(zipSync({ "word/document.xml": strToU8("<w:document><w:p><w:t>Quarterly note</w:t></w:p></w:document>") })),
      text: "Quarterly note",
    },
    {
      name: "deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.from(
        zipSync({
          "ppt/slides/slide1.xml": strToU8("<p:sld><a:t>Board slide</a:t></p:sld>"),
          "ppt/slides/slide2.xml": strToU8("<p:sld><a:t>Appendix</a:t></p:sld>"),
        }),
      ),
      text: "Board slide",
    },
    {
      name: "sheet.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(
        zipSync({
          "xl/sharedStrings.xml": strToU8("<sst><si><t>Revenue</t></si></sst>"),
          "xl/worksheets/sheet1.xml": strToU8('<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>12</v></c></row></sheetData>'),
        }),
      ),
      text: "Revenue",
    },
  ];
  for (const file of files) {
    await page.locator("input[type=file]").setInputFiles(file);
    await expect(page.getByRole("link", { name: new RegExp(file.name.replace(".", "\\.")) })).toBeVisible();
  }

  for (const file of files) {
    const email = `${file.name.split(".")[0]}@example.com`;
    await page.getByRole("link", { name: new RegExp(file.name.replace(".", "\\.")) }).click();
    await page.getByRole("button", { name: "Share" }).click();
    await page.getByLabel("Recipients").fill(email);
    await page.getByRole("button", { name: "Create" }).click();
    const link = await page.getByLabel("Link").inputValue();
    const viewer = await browser.newPage();
    await viewer.goto(link);
    await viewer.getByLabel("Email").fill(email);
    await viewer.getByRole("button", { name: "Continue" }).click();
    await expect(viewer.getByLabel("Code")).toHaveValue(/\d{6}/);
    const viewed = viewer.waitForResponse((response) => response.url().includes("/api/view/") && response.status() === 200);
    await viewer.getByRole("button", { name: "Sign in" }).click();
    const response = await viewed;
    expect(response.headers()["content-type"]).toContain("application/json");
    const body = await response.body();
    expect(body.subarray(0, 2).toString()).not.toBe("PK");
    expect(body.toString("utf8")).toContain(file.text);
    expect(body.toString("utf8")).not.toContain("word/document.xml");
    await expect(viewer.getByText(file.text)).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Download" })).toHaveCount(0);
    await viewer.close();
    await page.getByRole("link", { name: "Library" }).click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  }

  await page.getByRole("link", { name: /brief\.docx/ }).click();
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByLabel("Recipients").fill("locked@example.com");
  await page.getByLabel("Watermark").check();
  await page.getByRole("button", { name: "Create" }).click();
  const locked = await page.getByLabel("Link").inputValue();
  const blocked = await browser.newPage();
  await blocked.goto(locked);
  await blocked.getByLabel("Email").fill("locked@example.com");
  await blocked.getByRole("button", { name: "Continue" }).click();
  await expect(blocked.getByLabel("Code")).toHaveValue(/\d{6}/);
  const refused = blocked.waitForResponse((response) => response.url().includes("/api/view/"));
  await blocked.getByRole("button", { name: "Sign in" }).click();
  const denial = await refused;
  expect(denial.status()).toBe(403);
  const denialBody = await denial.body();
  expect(denialBody.subarray(0, 2).toString()).not.toBe("PK");
  expect(denialBody.toString("utf8")).not.toContain("Quarterly note");
  await expect(blocked.getByText("Could not open")).toBeVisible();
  await expect(blocked.getByRole("button", { name: "Download" })).toHaveCount(0);
});

test("a member cannot open admin", async ({ page }) => {
  await signIn(page, "bea@example.com");
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});
