// Seed the demo company with real context (profile + documents + context-graph nodes) so the
// memoryLoader has something to inject and the CEO plans grounded, on-brand tasks.
//
// Run:  pnpm seed
import { bootstrap, ensureCompany, db } from "../src/core/db.ts";
import { upsertDocument, upsertContextNode } from "../src/core/memory.ts";
import { markOnboarded } from "../src/core/queries.ts";

const COMPANY = "demo";

async function main() {
  await bootstrap();
  await ensureCompany(COMPANY, "BrewBox", "brewbox", {
    industry: "DTC coffee subscription",
    one_liner: "Freshly-roasted single-origin beans, shipped monthly.",
    stage: "pre-launch MVP",
    goal: "ship a landing page that converts to a paid monthly subscription",
  });

  await upsertDocument(COMPANY, "mission",
    "Make exceptional single-origin coffee effortless: roast-to-order beans delivered monthly, so anyone can drink cafe-quality coffee at home without thinking about it.");
  await upsertDocument(COMPANY, "product_overview",
    "BrewBox is a monthly subscription. Customers pick a roast level and grind; we ship freshly-roasted single-origin beans every month. Web app: marketing landing page + subscribe flow (Stripe). No mobile app.");
  await upsertDocument(COMPANY, "brand_voice",
    "Warm, unpretentious, a little nerdy about coffee. Short sentences. No corporate fluff. Talk like a knowledgeable friend, not a barista showing off.");

  await upsertContextNode(COMPANY, "company_profile", {
    name: "BrewBox", industry: "DTC coffee subscription", model: "monthly subscription (Stripe)",
  });
  await upsertContextNode(COMPANY, "user_context", {
    owner: "solo founder", comm_style: "concise, prefers bullet points and direct recommendations",
  });

  await markOnboarded(COMPANY); // seeded company is "already onboarded" → shows the dashboard, not the create screen
  console.log("seeded demo company 'BrewBox' (profile + 3 docs + 2 context nodes, onboarded)");
  await db().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
