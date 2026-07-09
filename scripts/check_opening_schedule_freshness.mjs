import path from "node:path";
import { validateOpeningScheduleManifest } from "./lib/source_manifest.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args["project-workspace"] || process.cwd());
const crosscheckPath = path.resolve(workspace, args.crosscheck || "outputs/opening_schedule_crosscheck.csv");
const manifestPath = path.resolve(workspace, args.manifest || "outputs/pdf_plan_index/opening_schedule_crosscheck_manifest.json");
const result = await validateOpeningScheduleManifest(crosscheckPath, manifestPath);

console.log(JSON.stringify(result));
if (result.issueCount > 0 || result.result === "No cross-check CSV") {
  process.exitCode = 2;
}
