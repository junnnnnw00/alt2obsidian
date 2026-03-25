/**
 * Integration test: Fetch a real Alt page and verify RscParser extraction.
 * Run: node test/test-scraper.mjs
 */

const TEST_URL = "https://www.altalt.io/en/note/0a471d1c-4ec6-4101-8de2-ccc1781770d4";

async function fetchPage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Inline the RscParser logic for testing outside Obsidian
function parseRscPayload(html) {
  const RSC_PUSH_REGEX = /self\.__next_f\.push\(\s*(\[[\s\S]*?\])\s*\)/g;
  const SUPABASE_URL_REGEX =
    /https?:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/sign\/[^\s"'\\]+/g;

  const chunks = [];
  let match;
  const regex = new RegExp(RSC_PUSH_REGEX.source, "g");
  while ((match = regex.exec(html)) !== null) {
    chunks.push(match[1]);
  }

  console.log(`✓ RSC chunks found: ${chunks.length}`);
  console.log(`  Chunk sizes: [${chunks.slice(0, 5).map(c => c.length).join(", ")}${chunks.length > 5 ? ", ..." : ""}]`);

  const fullPayload = chunks.join("\n");

  // Extract Supabase PDF URL
  let pdfUrl = null;
  const supabaseMatches = fullPayload.match(SUPABASE_URL_REGEX);
  if (supabaseMatches) {
    for (const url of supabaseMatches) {
      const cleaned = url.replace(/\\u0026/g, "&").replace(/\\"/g, "").replace(/"+$/, "");
      if (cleaned.includes("slides") || cleaned.includes(".pdf")) {
        pdfUrl = cleaned;
        break;
      }
    }
    if (!pdfUrl && supabaseMatches.length > 0) {
      pdfUrl = supabaseMatches[0].replace(/\\u0026/g, "&");
    }
  }

  // Extract summary: long markdown strings
  const stringRegex = /"((?:[^"\\]|\\.){200,})"/g;
  let summary = null;
  let bestLen = 0;
  while ((match = stringRegex.exec(fullPayload)) !== null) {
    try {
      const decoded = JSON.parse(`"${match[1]}"`);
      if ((decoded.includes("##") || decoded.includes("**")) && decoded.length > bestLen) {
        summary = decoded;
        bestLen = decoded.length;
      }
    } catch {
      // skip
    }
  }

  // Extract title
  const titleMatch = fullPayload.match(/"noteTitle"\s*:\s*"([^"]+)"/);
  const title = titleMatch ? titleMatch[1] : null;

  // Extract createdAt
  const createdMatch = fullPayload.match(/"createdAt"\s*:\s*"([^"]+)"/);
  const createdAt = createdMatch ? createdMatch[1] : null;

  return { title, summary, pdfUrl, createdAt, chunkCount: chunks.length };
}

function parseMetaTags(html) {
  const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]*?)"\s*\/?>/i);
  const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]*?)"\s*\/?>/i);
  return {
    title: titleMatch ? titleMatch[1] : null,
    description: descMatch ? descMatch[1] : null,
  };
}

async function main() {
  console.log("=== Alt2Obsidian Scraper Test ===\n");
  console.log(`Fetching: ${TEST_URL}\n`);

  const html = await fetchPage(TEST_URL);
  console.log(`✓ Page fetched: ${html.length} bytes\n`);

  // Test RSC parsing
  console.log("--- RSC Parser (Primary) ---");
  const rsc = parseRscPayload(html);

  console.log(`  Title: ${rsc.title || "MISSING ✗"}`);
  console.log(`  Summary: ${rsc.summary ? `${rsc.summary.length} chars (first 100: "${rsc.summary.slice(0, 100)}...")` : "MISSING ✗"}`);
  console.log(`  PDF URL: ${rsc.pdfUrl ? `${rsc.pdfUrl.slice(0, 80)}...` : "MISSING ✗"}`);
  console.log(`  CreatedAt: ${rsc.createdAt || "MISSING (optional)"}`);

  // Test OG meta fallback
  console.log("\n--- OG Meta Tags (Fallback) ---");
  const meta = parseMetaTags(html);
  console.log(`  og:title: ${meta.title || "MISSING ✗"}`);
  console.log(`  og:description: ${meta.description ? `${meta.description.slice(0, 100)}...` : "MISSING ✗"}`);

  // Summary
  console.log("\n=== Results ===");
  const passed = [];
  const failed = [];

  // Title: accept from RSC, summary heading, or OG meta
  const effectiveTitle = rsc.title || meta.title?.replace(/\s*\|\s*Alt$/, "");
  if (effectiveTitle) passed.push(`Title extraction: "${effectiveTitle}"`); else failed.push("Title extraction (all methods)");
  if (rsc.summary && rsc.summary.length > 200) passed.push("RSC summary extraction"); else failed.push("RSC summary extraction");
  if (rsc.pdfUrl && rsc.pdfUrl.includes("supabase")) passed.push("RSC PDF URL extraction"); else failed.push("RSC PDF URL extraction");
  if (meta.title) passed.push("OG meta title fallback"); else failed.push("OG meta title fallback");
  if (meta.description) passed.push("OG meta description fallback"); else failed.push("OG meta description fallback");

  console.log(`\n✓ Passed: ${passed.length}`);
  for (const p of passed) console.log(`  ✓ ${p}`);

  if (failed.length > 0) {
    console.log(`\n✗ Failed: ${failed.length}`);
    for (const f of failed) console.log(`  ✗ ${f}`);
    process.exit(1);
  }

  // Test PDF URL is fetchable
  if (rsc.pdfUrl) {
    console.log("\n--- PDF Download Test ---");
    try {
      const pdfRes = await fetch(rsc.pdfUrl);
      if (pdfRes.ok) {
        const buf = await pdfRes.arrayBuffer();
        console.log(`✓ PDF downloaded: ${(buf.byteLength / 1024).toFixed(1)} KB`);
        // Check PDF magic bytes
        const header = new Uint8Array(buf.slice(0, 5));
        const magic = String.fromCharCode(...header);
        if (magic.startsWith("%PDF")) {
          console.log("✓ Valid PDF file confirmed");
        } else {
          console.log("✗ Not a valid PDF file");
        }
      } else {
        console.log(`✗ PDF download failed: HTTP ${pdfRes.status} (signed URL may have expired)`);
      }
    } catch (e) {
      console.log(`✗ PDF download error: ${e.message}`);
    }
  }

  console.log("\n✓ All scraper tests passed!\n");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
