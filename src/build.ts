import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const MINIFY = process.argv.includes("--minify");
const ROOT = path.resolve(import.meta.dirname, "..");

function run(cmd: string) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

// Server TS → dist/
run("npx tsc");

// Client TS → dist/public/app.js (always same filename)
const outDir = path.join(ROOT, "dist", "public");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const minifyFlag = MINIFY ? "--minify" : "";
run(`npx esbuild src/frontend/app.ts --bundle --outfile=dist/public/app.js --platform=browser --target=es2020 --format=iife ${minifyFlag}`.trim());

// CSS: compile with Tailwind
run(`npx @tailwindcss/cli -i src/frontend/style.css -o dist/public/style.css${MINIFY ? " --minify" : ""}`);
run(`npx @tailwindcss/cli -i src/frontend/style2.css -o dist/public/style2.css${MINIFY ? " --minify" : ""}`);

// Copy static assets to dist/public/
fs.copyFileSync(path.join(ROOT, "public", "index.html"), path.join(outDir, "index.html"));

console.log(`✓ build complete${MINIFY ? " (minified)" : ""}`);
