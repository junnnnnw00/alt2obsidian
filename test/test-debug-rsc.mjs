/**
 * Debug: dump all RSC chunks to understand the format
 */
const TEST_URL = "https://www.altalt.io/en/note/d610372c-9850-4a1f-8498-01d5ff3231cd";

async function main() {
  const res = await fetch(TEST_URL);
  const html = await res.text();

  // Method 1: self.__next_f.push() chunks
  const pushRegex = /self\.__next_f\.push\(\s*(\[[\s\S]*?\])\s*\)/g;
  let m;
  let i = 0;
  console.log("=== self.__next_f.push() chunks ===\n");
  while ((m = pushRegex.exec(html)) !== null) {
    const chunk = m[1];
    console.log(`Chunk ${i}: ${chunk.length} chars`);
    // Show first 300 chars
    console.log(`  Preview: ${chunk.slice(0, 300).replace(/\n/g, "\\n")}`);
    console.log();
    i++;
  }

  // Method 2: Look for script tags with __next_f
  console.log("\n=== Script tags with content ===\n");
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let si = 0;
  while ((m = scriptRegex.exec(html)) !== null) {
    const content = m[1].trim();
    if (content.length > 100 && content.includes("__next_f")) {
      console.log(`Script ${si}: ${content.length} chars`);
      console.log(`  Preview: ${content.slice(0, 200).replace(/\n/g, "\\n")}`);
      console.log();
    }
    si++;
  }

  // Method 3: Search for Korean text anywhere
  console.log("\n=== Korean text occurrences ===\n");
  const koreanRegex = /[\uAC00-\uD7AF]{3,}/g;
  const koreanMatches = [];
  while ((m = koreanRegex.exec(html)) !== null) {
    koreanMatches.push({ text: m[0], index: m.index });
  }
  console.log(`Korean text fragments: ${koreanMatches.length}`);
  for (const km of koreanMatches.slice(0, 10)) {
    const context = html.slice(Math.max(0, km.index - 50), km.index + km.text.length + 50);
    console.log(`  ...${context.replace(/\n/g, "\\n").slice(0, 150)}...`);
  }

  // Method 4: Search for "text" field patterns more broadly
  console.log("\n=== 'text' field patterns ===\n");
  const textFieldRegex = /text['":\s]+([^\n]{20,200})/g;
  let count = 0;
  while ((m = textFieldRegex.exec(html)) !== null && count < 10) {
    const val = m[1];
    if (/[\uAC00-\uD7AF]/.test(val) || /\b(register|pipeline|hazard)\b/i.test(val)) {
      console.log(`  ${val.slice(0, 150)}`);
      count++;
    }
  }

  // Method 5: Look for the large T chunk
  console.log("\n=== Large data chunks (T format) ===\n");
  const tChunkRegex = /self\.__next_f\.push\(\[1,"([0-9a-f]+):T([0-9a-f]+),([\s\S]*?)"\]\)/g;
  while ((m = tChunkRegex.exec(html)) !== null) {
    const id = m[1];
    const sizeHex = m[2];
    const size = parseInt(sizeHex, 16);
    console.log(`T-chunk id=${id}, declared size=${size}, data preview: ${m[3].slice(0, 200)}`);
  }

  // Method 6: Just find any chunk with "1b:" prefix
  console.log("\n=== Chunks starting with 1b: ===\n");
  const idx1b = html.indexOf("1b:");
  if (idx1b >= 0) {
    console.log(`Found at index ${idx1b}`);
    console.log(`Context: ${html.slice(idx1b, idx1b + 500).replace(/\n/g, "\\n")}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
