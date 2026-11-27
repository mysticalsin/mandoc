import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { FileType } from "./files.js";
import { xmlEscape } from "./xml.js";

function acceptableEmail(email: string): boolean {
  return email.length > 0 && email.length <= 320 && !/[\u0000-\u001f]/.test(email);
}

function textOf(files: Record<string, Uint8Array>, name: string): string | null {
  const bytes = files[name];
  return bytes ? strFromU8(bytes) : null;
}

function headerXml(email: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:p>
    <w:r>
      <w:rPr><w:color w:val="8C3030"/><w:sz w:val="56"/></w:rPr>
      <w:t xml:space="preserve">${email}</w:t>
    </w:r>
    <w:r>
      <w:pict>
        <v:shape id="MandocWatermark" style="position:absolute;margin-left:0;margin-top:0;width:468pt;height:90pt;rotation:-2880000;z-index:-251656192" filled="f" stroked="f">
          <v:textpath style="font-family:Arial" on="t" string="${email}"/>
        </v:shape>
      </w:pict>
    </w:r>
  </w:p>
</w:hdr>`;
}

function stampDocx(files: Record<string, Uint8Array>, email: string): Record<string, Uint8Array> | null {
  const document = textOf(files, "word/document.xml");
  if (!document || !/<w:body[\s>]/.test(document)) return null;
  const safe = xmlEscape(email);
  const mark = `<w:p><w:r><w:rPr><w:color w:val="8C3030"/><w:sz w:val="56"/></w:rPr><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
  let xml = document.replace(/<w:body(\s[^>]*)?>/, (open) => `${open}${mark}`);
  if (xml === document) return null;
  if (/<w:sectPr\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/<w:sectPr(\s[^>]*)?\/>/g, `<w:sectPr$1><w:headerReference w:type="default" r:id="rIdMandoc"/></w:sectPr>`);
  }
  if (xml.includes("</w:sectPr>")) {
    xml = xml.replaceAll("</w:sectPr>", `<w:headerReference w:type="default" r:id="rIdMandoc"/></w:sectPr>`);
  } else {
    xml = xml.replace("</w:body>", `<w:sectPr><w:headerReference w:type="default" r:id="rIdMandoc"/></w:sectPr></w:body>`);
  }
  files["word/document.xml"] = strToU8(xml);
  files["word/header-mandoc.xml"] = strToU8(headerXml(safe));
  const types = textOf(files, "[Content_Types].xml");
  const override = `<Override PartName="/word/header-mandoc.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`;
  if (types?.includes("</Types>") && !types.includes("/word/header-mandoc.xml")) {
    files["[Content_Types].xml"] = strToU8(types.replace("</Types>", `${override}</Types>`));
  }
  const relsName = "word/_rels/document.xml.rels";
  const rels = textOf(files, relsName);
  const relationship = `<Relationship Id="rIdMandoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header-mandoc.xml"/>`;
  if (rels?.includes("</Relationships>") && !rels.includes("rIdMandoc")) {
    files[relsName] = strToU8(rels.replace("</Relationships>", `${relationship}</Relationships>`));
  } else if (!rels) {
    files[relsName] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`,
    );
  }
  return files;
}

function slideShape(email: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="90001" name="MandocStamp"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="-1680000"><a:off x="1200000" y="2800000"/><a:ext cx="7000000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2800"><a:solidFill><a:srgbClr val="8C3030"><a:alpha val="55000"/></a:srgbClr></a:solidFill></a:rPr><a:t>${email}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function stampPptx(files: Record<string, Uint8Array>, email: string): Record<string, Uint8Array> | null {
  const slides = Object.keys(files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  if (slides.length === 0) return null;
  const shape = slideShape(xmlEscape(email));
  let stamped = 0;
  for (const name of slides) {
    const xml = strFromU8(files[name] ?? new Uint8Array());
    if (!xml.includes("</p:spTree>")) continue;
    files[name] = strToU8(xml.includes('name="MandocStamp"') ? xml : xml.replace("</p:spTree>", `${shape}</p:spTree>`));
    stamped += 1;
  }
  return stamped > 0 ? files : null;
}

function stampSheet(xml: string, email: string): string | null {
  if (!xml.includes("</worksheet>")) return null;
  const header = `<oddHeader>&amp;C&amp;K8C3030 ${email}</oddHeader>`;
  if (xml.includes("<oddHeader")) return xml.replace(/<oddHeader[^>]*>[\s\S]*?<\/oddHeader>/, header);
  if (xml.includes("<headerFooter")) return xml.replace(/<headerFooter(\s[^>]*)?>/, (open) => `${open}${header}`);
  return xml.replace("</worksheet>", `<headerFooter>${header}</headerFooter></worksheet>`);
}

function stampXlsx(files: Record<string, Uint8Array>, email: string): Record<string, Uint8Array> | null {
  const sheets = Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (sheets.length === 0) return null;
  const safe = xmlEscape(email);
  let stamped = 0;
  for (const name of sheets) {
    const xml = strFromU8(files[name] ?? new Uint8Array());
    const next = stampSheet(xml, safe);
    if (!next) continue;
    files[name] = strToU8(next);
    stamped += 1;
  }
  return stamped > 0 ? files : null;
}

/** Rewrites an Office package so the viewer email is inside the file. Null refuses the bytes. */
export function stampOffice(bytes: Uint8Array, fileType: FileType, email: string): Uint8Array | null {
  if (fileType === "pdf" || !acceptableEmail(email)) return null;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return null;
  }
  const stamped = fileType === "docx" ? stampDocx(files, email) : fileType === "pptx" ? stampPptx(files, email) : stampXlsx(files, email);
  if (!stamped) return null;
  return zipSync(stamped);
}
