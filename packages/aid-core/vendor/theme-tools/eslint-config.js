/**
 * @theme-tools/testing/eslint-config (L01)
 *
 * Composable ESLint v9+ flat-config preset builder, runtime/module import boundary
 * verifier, and Storybook CSF3 story lint evaluator across the theme.tools and
 * Megabyte Labs estate.
 *
 * Reconciles shared-library recommendation L01 (`eslint-config`) into the canonical
 * `@theme-tools/testing` quality and conformance package without introducing a
 * redundant single-file wrapper package.
 */
import { isInstalledPath, normalizePortablePath } from "./consumer-project-path.js";
const DEFAULT_IGNORES = [
    "**/dist/**",
    "**/node_modules/**",
    "**/.wrangler/**",
    "**/storybook-static/**",
    "**/.artifacts/**",
    "**/coverage/**",
];
const NODE_ONLY_BUILTINS = new Set([
    "fs",
    "node:fs",
    "fs/promises",
    "node:fs/promises",
    "child_process",
    "node:child_process",
    "cluster",
    "node:cluster",
    "dgram",
    "node:dgram",
    "net",
    "node:net",
    "tls",
    "node:tls",
    "worker_threads",
    "node:worker_threads",
]);
export function validateEslintConsumerRoot(tsconfigRootDir, sharedPackageInstalledDir) {
    if (!tsconfigRootDir || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(tsconfigRootDir)) {
        return {
            valid: false,
            resolvedTsconfigRootDir: "",
            usedInstalledDirectoryAsRoot: false,
            reason: "tsconfigRootDir must be the absolute consumer project root",
        };
    }
    const root = normalizePortablePath(tsconfigRootDir);
    const installed = sharedPackageInstalledDir ? normalizePortablePath(sharedPackageInstalledDir) : undefined;
    const usedInstalledDirectoryAsRoot = isInstalledPath(root)
        || (installed !== undefined && (root === installed || root.startsWith(`${installed}/`)));
    return {
        valid: !usedInstalledDirectoryAsRoot,
        resolvedTsconfigRootDir: root,
        usedInstalledDirectoryAsRoot,
        ...(usedInstalledDirectoryAsRoot
            ? { reason: "tsconfigRootDir must be the consumer project root outside installed dependencies" }
            : {}),
    };
}
/**
 * Builds a deterministic ESLint v9 flat-config array tailored to the target runtime
 * (`worker`, `browser`, `node`, `tooling`, `library`, `storybook`, `test`).
 */
export function createThemeToolsEslintFlatConfig(options) {
    if (options.tsconfigRootDir !== undefined) {
        const validation = validateEslintConsumerRoot(options.tsconfigRootDir);
        if (!validation.valid)
            throw new TypeError(validation.reason);
    }
    const ignores = Array.from(new Set([...DEFAULT_IGNORES, ...(options.customIgnores ?? [])]));
    const baseGlobals = {
        console: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        crypto: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        structuredClone: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
    };
    if (options.runtime === "browser" || options.runtime === "storybook") {
        baseGlobals.window = "readonly";
        baseGlobals.document = "readonly";
        baseGlobals.navigator = "readonly";
        baseGlobals.HTMLElement = "readonly";
        baseGlobals.CustomEvent = "readonly";
    }
    if (options.runtime === "node" || options.runtime === "tooling" || options.runtime === "test") {
        baseGlobals.process = "readonly";
        baseGlobals.Buffer = "readonly";
    }
    const restrictedImports = [
        "@theme.tools/*/src/**",
        "@theme-tools/*/src/**",
        "@theme.tools/*/dist/**",
        "@theme-tools/*/dist/**",
    ];
    if (options.runtime === "worker" || options.runtime === "browser" || options.runtime === "storybook") {
        restrictedImports.push("node:child_process", "child_process", "node:fs", "fs", "node:net", "net");
    }
    const configs = [
        {
            name: "@theme-tools/eslint-config/ignores",
            files: ["**/*"],
            ignores,
            rules: {},
        },
        {
            name: `@theme-tools/eslint-config/core-${options.runtime}`,
            files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.mjs"],
            ignores,
            languageOptions: {
                ecmaVersion: 2024,
                sourceType: "module",
                globals: baseGlobals,
            },
            rules: {
                "no-debugger": "error",
                "no-eval": "error",
                "no-implied-eval": "error",
                "no-var": "error",
                "prefer-const": "error",
                eqeqeq: ["error", "always"],
                "no-restricted-imports": [
                    "error",
                    {
                        patterns: restrictedImports,
                    },
                ],
            },
        },
    ];
    if (options.enableStorybookPlugin || options.runtime === "storybook") {
        const plugins = {};
        if (options.storybookPluginInstance !== undefined) {
            plugins.storybook = options.storybookPluginInstance;
        }
        configs.push({
            name: "@theme-tools/eslint-config/storybook-csf3",
            files: ["**/*.stories.ts", "**/*.stories.tsx"],
            ignores,
            ...(Object.keys(plugins).length > 0 ? { plugins } : {}),
            rules: {
                "no-debugger": "error",
                "prefer-const": "error",
            },
        });
    }
    return configs;
}
/**
 * Evaluates module import specifiers across package and runtime boundaries to verify
 * zero cross-package internal `src/` imports, zero Node-only builtins in edge/browser
 * bundles, and zero server secret leaks into browser bundles.
 */
export function evaluateModuleImportBoundaries(candidates) {
    const violations = [];
    let checkedImports = 0;
    for (const candidate of candidates) {
        for (const specifier of candidate.importSpecifiers) {
            checkedImports += 1;
            const crossPackageInternalPattern = /^(@theme\.tools|@theme-tools)\/([^/]+)\/(src|dist)\//.exec(specifier);
            if (crossPackageInternalPattern) {
                const targetPkg = `${crossPackageInternalPattern[1]}/${crossPackageInternalPattern[2]}`;
                if (targetPkg !== candidate.packageName) {
                    violations.push({
                        sourceFile: candidate.sourceFile,
                        specifier,
                        ruleId: "no-cross-package-internal-src-import",
                        message: `Cross-package internal import '${specifier}' bypasses public package exports of '${targetPkg}'. Use documented subpath exports instead.`,
                    });
                }
            }
            if (/^(?:\.\.\/){2,}packages\/([^/]+)\/src\//.test(specifier)) {
                violations.push({
                    sourceFile: candidate.sourceFile,
                    specifier,
                    ruleId: "no-cross-package-internal-src-import",
                    message: `Relative cross-package import '${specifier}' bypasses package boundaries. Import via package name and public subpath instead.`,
                });
            }
            if ((candidate.runtime === "worker" ||
                candidate.runtime === "browser" ||
                candidate.runtime === "storybook") &&
                NODE_ONLY_BUILTINS.has(specifier)) {
                violations.push({
                    sourceFile: candidate.sourceFile,
                    specifier,
                    ruleId: "no-node-fs-or-process-in-edge-or-browser",
                    message: `Node-only builtin '${specifier}' is forbidden in '${candidate.runtime}' runtime targets.`,
                });
            }
            if ((candidate.runtime === "browser" || candidate.runtime === "storybook") &&
                (specifier.includes(".server") || specifier.includes("/secrets") || specifier.includes("infisical-admin"))) {
                violations.push({
                    sourceFile: candidate.sourceFile,
                    specifier,
                    ruleId: "no-server-secret-in-browser-bundle",
                    message: `Server-only or secret authority module '${specifier}' cannot be imported inside '${candidate.runtime}' code.`,
                });
            }
        }
    }
    return {
        passed: violations.length === 0,
        checkedFiles: candidates.length,
        checkedImports,
        violations,
    };
}
/**
 * Evaluates Storybook `.stories.ts` / `.stories.tsx` source descriptors for CSF3
 * compliance (default Meta export, at least one named story export, PascalCase story
 * exports, and zero explicit `: any` type annotations).
 */
export function evaluateStorybookLintRules(stories) {
    const violations = [];
    for (const story of stories) {
        const hasDefaultExport = /\bexport\s+default\s+/.test(story.sourceText);
        if (!hasDefaultExport) {
            violations.push({
                filePath: story.filePath,
                ruleId: "storybook/default-exports",
                message: "Storybook CSF3 files must include a default Meta export.",
            });
        }
        const namedExportMatches = Array.from(story.sourceText.matchAll(/\bexport\s+const\s+([A-Za-z0-9_]+)\b/g)).map((m) => m[1] ?? "");
        const nonMetaExports = namedExportMatches.filter((name) => name !== "meta" && name.length > 0);
        if (nonMetaExports.length === 0) {
            violations.push({
                filePath: story.filePath,
                ruleId: "storybook/story-exports",
                message: "Storybook CSF3 files must export at least one named StoryObj constant.",
            });
        }
        for (const exportName of nonMetaExports) {
            const firstChar = exportName.charAt(0);
            if (firstChar !== firstChar.toUpperCase()) {
                violations.push({
                    filePath: story.filePath,
                    ruleId: "storybook/prefer-pascal-case",
                    message: `Exported story '${exportName}' should use PascalCase naming.`,
                });
            }
        }
        if (/:\s*any\b|\bas\s+any\b/.test(story.sourceText)) {
            violations.push({
                filePath: story.filePath,
                ruleId: "storybook/no-untyped-any-args",
                message: "Storybook stories must not use explicit 'any' type annotations or assertions.",
            });
        }
    }
    return {
        passed: violations.length === 0,
        filesChecked: stories.length,
        violations,
    };
}
//# sourceMappingURL=eslint-config.js.map