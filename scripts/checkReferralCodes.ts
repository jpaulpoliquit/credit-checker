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

async function checkReferral(code: string): Promise<"active" | "redeemed" | "unknown"> {
  try {
    const { body, statusCode } = await request(API_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "origin": "https://cursor.com",
        "referer": `https://cursor.com/referral?code=${code}`,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" +
          " AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ code }),
    });

    if (statusCode !== 200) {
      const text = await body.text();
      console.warn(`Non-200 response for ${code}: ${statusCode} -> ${text}`);
      return "unknown";
    }

    const json = await body.json();
    if (json && typeof json === "object" && "isValid" in json) {
      const { isValid, userIsEligible } = json as { isValid: boolean; userIsEligible: boolean };
      return isValid && userIsEligible ? "active" : "redeemed";
    }

    if (json && Object.keys(json).length === 0) {
      return "redeemed";
    }

    return "unknown";
  } catch (error) {
    console.error(`Error checking code ${code}:`, error);
    return "unknown";
  }
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

  return summaryLines.join("\n");
}

async function main() {
  const path = process.argv[2] ?? "ep02.md";
  const backupPath = `${path}.bak`;

  const original = await readFile(path, "utf8");
  await writeFile(backupPath, original, "utf8");

  const urls = await readReferralLinks(path);
  const statuses: ReferralStatus[] = [];
  const timestamp = new Date().toISOString();

  for (const url of urls) {
    const code = extractCode(url);
    if (!code) {
      console.warn(`Could not extract code from ${url}`);
      statuses.push({ url, status: "unknown", lastChecked: timestamp });
      continue;
    }

    const status = await checkReferral(code);
    statuses.push({ url, status, lastChecked: timestamp });
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

