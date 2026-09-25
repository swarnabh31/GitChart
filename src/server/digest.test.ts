import { describe, expect, it } from "vitest";
import type { TreeEntry } from "./github";
import { scoreFile, selectDigestFiles, LARGE_BUDGET, MEDIUM_BUDGET } from "./digest";

const T = (path: string, size = 5_000): TreeEntry => ({ path, type: "blob", size, mode: "100644" });

describe("scoreFile", () => {
  const empty: TreeEntry[] = [];

  it("scores main entrypoints highly", () => {
    expect(scoreFile("main.py", 5_000, empty)).toBe(40);
    expect(scoreFile("app.ts", 5_000, empty)).toBe(40);
  });

  it("scores framework route/server/page files under app or pages", () => {
    expect(scoreFile("app/api/route.ts", 5_000, empty)).toBe(40);
    expect(scoreFile("pages/api/+server.ts", 5_000, empty)).toBe(35 + 5);
    expect(scoreFile("src/routes/page.tsx", 5_000, empty)).toBe(0);
  });

  it("scores role-named files", () => {
    expect(scoreFile("src/server/pipeline.ts", 5_000, empty)).toBe(30);
    expect(scoreFile("src/repositories.ts", 5_000, empty)).toBe(25 + 5);
  });

  it("scores ai-domain-named files", () => {
    expect(scoreFile("inference/tokenizer.py", 5_000, empty)).toBe(20);
    expect(scoreFile("src/embeddings.py", 5_000, empty)).toBe(20 + 5);
  });

  it("scores manifests and README", () => {
    expect(scoreFile("package.json", 2_000, empty)).toBe(15);
    expect(scoreFile("Cargo.toml", 2_000, empty)).toBe(15);
    expect(scoreFile("README.md", 5_000, empty)).toBe(10);
  });

  it("penalizes test files", () => {
    expect(scoreFile("src/__tests__/foo.test.ts", 5_000, empty)).toBe(-60);
    expect(scoreFile("e2e/flow.spec.ts", 5_000, empty)).toBe(-60);
  });

  it("penalizes scripts and tooling dirs", () => {
    expect(scoreFile("scripts/migrate.ts", 5_000, empty)).toBe(-70);
    expect(scoreFile(".github/workflows/ci.yml", 5_000, empty)).toBe(-70);
  });

  it("penalizes health checks and build artifacts", () => {
    expect(scoreFile("healthz.ts", 5_000, empty)).toBe(-80);
    expect(scoreFile("out.js.map", 5_000, empty)).toBe(-90);
    expect(scoreFile("Gemfile.lock", 5_000, empty)).toBe(-90);
  });

  it("penalizes telemetry dirs", () => {
    expect(scoreFile("src/analytics/track.ts", 5_000, empty)).toBe(-55);
  });

  it("penalizes tiny files", () => {
    expect(scoreFile("src/filler.ts", 100, empty)).toBe(-40 + 5);
    expect(scoreFile("filler.ts", 100, empty)).toBe(-40);
  });

  it("penalizes very large files", () => {
    expect(scoreFile("src/huge.ts", 300_000, empty)).toBe(-30 + 5);
    expect(scoreFile("huge.ts", 300_000, empty)).toBe(-30);
  });

  it("clamps scores to [-100, 100]", () => {
    expect(scoreFile("app/api/route.ts", 100, empty)).toBe(0);
    expect(scoreFile("scripts/jobs/worker.test.ts", 100, empty)).toBe(-100);
  });

  it("adds monorepo bonus to the package manifest in a known package dir", () => {
    const tree = [T("root/package.json", 2_000), T("packages/server/package.json", 2_000), T("packages/ui/package.json", 2_000)];
    expect(scoreFile("packages/server/package.json", 2_000, tree)).toBe(15 + 5 + 30);
  });
});

describe("selectDigestFiles", () => {
  it("prefers a real service file over component indexes and skips scripts", () => {
    const tree = [
      T("package.json", 2_000),
      T("src/server/pipeline.ts", 8_000),
      T("src/components/index.ts", 4_000),
      T("src/components/Button.tsx", 4_000),
      T("src/components/Card.tsx", 4_000),
      T("scripts/migrate.ts", 4_000),
      T("scripts/deploy.ts", 4_000),
    ];
    const picked = selectDigestFiles(tree, MEDIUM_BUDGET).map((f) => f.path);
    expect(picked).toContain("src/server/pipeline.ts");
    const firstComponent = picked.findIndex((p) => p.startsWith("src/components/"));
    expect(picked.indexOf("src/server/pipeline.ts")).toBeLessThan(firstComponent);
    expect(picked).not.toContain("scripts/migrate.ts");
    expect(picked).not.toContain("scripts/deploy.ts");
  });

  it("caps a single directory at 2 files unless one is the top scorer there", () => {
    const tree = [
      T("src/components/Alpha.tsx", 4_000),
      T("src/components/Beta.tsx", 4_000),
      T("src/components/Gamma.tsx", 4_000),
      T("src/components/Delta.tsx", 4_000),
      T("src/components/Epsilon.tsx", 4_000),
      T("src/components/Zeta.tsx", 4_000),
      T("main.ts", 5_000),
    ];
    const picked = selectDigestFiles(tree, LARGE_BUDGET);
    const fromComponents = picked.filter((f) => f.path.startsWith("src/components/"));
    expect(fromComponents.length).toBeLessThanOrEqual(2);
  });

  it("respects the total byte budget", () => {
    const tree = Array.from({ length: 20 }, (_, i) => T(`src/mods/m${i}.ts`, 100_000));
    const picked = selectDigestFiles(tree, MEDIUM_BUDGET);
    const used = picked.reduce((sum, f) => sum + Math.min(f.size, MEDIUM_BUDGET.excerpt), 0);
    expect(used).toBeLessThanOrEqual(MEDIUM_BUDGET.total + MEDIUM_BUDGET.excerpt);
    expect(picked.length).toBeLessThanOrEqual(MEDIUM_BUDGET.maxFiles);
  });
});
