import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { createReadStream } from "node:fs";
import { request } from "undici";

interface ReferralStatus {
  url: string;
  status: "active" | "redeemed" | "unknown";
  lastChecked: string;
}

const REFERRAL_REGEX = /https?:\/\/cursor\.com\/referral\?code=([A-Z0-9]+)/i;
const API_ENDPOINT = "https://cursor.com/api/dashboard/check-referral-code";
const DELAY_MS = parseInt(process.env.CHECK_DELAY_MS ?? "1000", 10);
const COOKIES = process.env.CURSOR_COOKIES ?? "";

async function readReferralLinks(path: string): Promise<string[]> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const urls: string[] = [];
  for await (const line of rl) {
    const match = line.match(REFERRAL_REGEX);
    if (match) {
      urls.push(match[0]);
    }
  }

  return urls;
}

async function checkReferral(code: string, retries = 3): Promise<"active" | "redeemed" | "unknown"> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS * attempt));
      }

      const headers: Record<string, string> = {
        "accept": "application/json",
        "content-type": "application/json",
        "origin": "https://cursor.com",
        "referer": `https://cursor.com/referral?code=${code}`,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" +
          " AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      };

      if (COOKIES) {
        headers["cookie"] = COOKIES;
      }

      const { body, statusCode } = await request(API_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ code }),
      });

      if (statusCode === 200) {
        const json = await body.json();
        console.log(`Code ${code}: HTTP 200`, JSON.stringify(json));

        // Active link returns: { isValid: true, userIsEligible: true, metadata: {...} }
        if (json && typeof json === "object" && "isValid" in json) {
          const { isValid, userIsEligible } = json as { isValid: boolean; userIsEligible: boolean };
          if (isValid && userIsEligible) {
            return "active";
          }
          return "redeemed";
        }

        // Empty object {} means already redeemed
        if (json && typeof json === "object" && Object.keys(json).length === 0) {
          return "redeemed";
        }

        return "unknown";
      }

      // HTTP 500 likely means auth required or rate limiting, not "redeemed"
      if (statusCode === 500) {
        const text = await body.text();
        console.warn(`HTTP 500 for ${code} (attempt ${attempt + 1}/${retries}): ${text}`);
        if (attempt < retries - 1) continue;
        return "unknown";
      }

      const text = await body.text();
      console.warn(`Unexpected response for ${code}: HTTP ${statusCode} -> ${text}`);
      return "unknown";
    } catch (error) {
      console.error(`Error checking code ${code} (attempt ${attempt + 1}/${retries}):`, error);
      if (attempt < retries - 1) continue;
      return "unknown";
    }
  }
  return "unknown";
}

function extractCode(url: string): string | null {
  const match = url.match(REFERRAL_REGEX);
  return match?.[1] ?? null;
}

function buildTable(statuses: ReferralStatus[]): string {
  const lines = ["| URL | Status | Last Checked |", "| --- | --- | --- |"];
  for (const item of statuses) {
    lines.push(`| ${item.url} | ${item.status} | ${item.lastChecked} |`);
  }
  return lines.join("\n");
}

function summarize(statuses: ReferralStatus[]): string {
  const redeemed = statuses.filter((s) => s.status === "redeemed").length;
  const active = statuses.filter((s) => s.status === "active");
  const unknown = statuses.filter((s) => s.status === "unknown").length;

  const summaryLines = [
    `Checked ${statuses.length} referral links.`,
    `${redeemed} redeemed, ${active.length} active, ${unknown} unknown.`,
  ];

  if (active.length > 0) {
    summaryLines.push("Active links:");
    for (const item of active) {
      summaryLines.push(` - ${item.url}`);
    }
  }

  if (redeemed > 0) {
    summaryLines.push("Redeemed links:");
    for (const item of statuses.filter((s) => s.status === "redeemed")) {
      summaryLines.push(` - ${item.url}`);
    }
  }

  return summaryLines.join("\n");
}

async function main() {
  const path = process.argv[2] ?? "ep02.md";
  const backupPath = `${path}.bak`;

  const original = await readFile(path, "utf8");
  await writeFile(backupPath, original, "utf8");

  const urls = await readReferralLinks(path);
  const statuses: ReferralStatus[] = [];

  console.log(`Checking ${urls.length} referral codes...`);
  if (!COOKIES) {
    console.warn("⚠️  No CURSOR_COOKIES set - API calls will likely fail with HTTP 500");
    console.warn("   Export your browser cookies to CURSOR_COOKIES environment variable");
  }

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const code = extractCode(url);
    const timestamp = new Date().toISOString();

    if (!code) {
      console.warn(`Could not extract code from ${url}`);
      statuses.push({ url, status: "unknown", lastChecked: timestamp });
      continue;
    }

    console.log(`[${i + 1}/${urls.length}] Checking ${code}...`);
    const status = await checkReferral(code);
    statuses.push({ url, status, lastChecked: timestamp });

    // Delay between different codes to avoid rate limiting
    if (i < urls.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  const table = buildTable(statuses);
  await writeFile(path, `${table}\n`, "utf8");

  const summary = summarize(statuses);
  console.log(summary);
}

main().catch((error) => {
  console.error("Failed to process referral codes:", error);
  process.exitCode = 1;
});

