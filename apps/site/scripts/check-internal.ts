interface InternalCheck {
  description: string;
  run: () => Promise<boolean>;
}

const fileExists = (path: string): Promise<boolean> => Bun.file(path).exists();

const checks: InternalCheck[] = [
  {
    description: "package.json must exist at the project root",
    run: () => fileExists("package.json"),
  },
  {
    description: "site config must exist (site.jsonc)",
    run: () => fileExists("site.jsonc"),
  },
  {
    description: "tailwind input must exist (styles/tailwind.css)",
    run: () => fileExists("styles/tailwind.css"),
  },
  {
    description: "source UI entry must exist (src/ui/layout.tsx)",
    run: () => fileExists("src/ui/layout.tsx"),
  },
];

const runInternalChecks = async (): Promise<string[]> => {
  const failures: string[] = [];

  for (const check of checks) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await check.run();
    if (!ok) {
      failures.push(check.description);
    }
  }

  return failures;
};

const main = async (): Promise<number> => {
  const failures = await runInternalChecks();
  if (failures.length === 0) {
    console.log("Internal checks passed.");
    return 0;
  }

  console.error("Internal checks failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  return 1;
};

const code = await main();
process.exit(code);
