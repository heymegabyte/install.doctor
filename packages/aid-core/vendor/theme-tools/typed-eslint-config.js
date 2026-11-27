import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import { validateEslintConsumerRoot } from "./eslint-config.js";
import { themeToolsEslintPlugin } from "./eslint-plugin.js";
export { themeToolsEslintPlugin };
/** Adds type-aware checks to TypeScript files that belong to consumer projects. */
export function createThemeToolsTypedLintConfig(options) {
    const validation = validateEslintConsumerRoot(options.tsconfigRootDir);
    if (!validation.valid)
        throw new TypeError(validation.reason);
    const { project } = options;
    if (project !== undefined && project.trim() === "") {
        throw new TypeError("Expected a nonempty TypeScript project path");
    }
    const files = [...(options.files ?? ["**/*.{ts,tsx,mts,cts}"])];
    const typed = defineConfig({
        name: "@theme-tools/testing/typed-typescript",
        files,
        extends: options.profile === "migration"
            ? tseslint.configs.recommendedTypeChecked
            : tseslint.configs.strictTypeChecked,
        languageOptions: {
            parserOptions: {
                projectService: project === undefined,
                project: project ?? false,
                tsconfigRootDir: options.tsconfigRootDir,
            },
        },
    });
    const boundaries = {
        name: "@theme-tools/testing/public-package-boundaries",
        files,
        plugins: { "theme-tools": themeToolsEslintPlugin },
        rules: {
            "@typescript-eslint/switch-exhaustiveness-check": options.profile === "migration" ? "off" : "error",
            "theme-tools/no-unvalidated-external-boundary": options.profile === "migration" ? "off" : "error",
            "theme-tools/no-private-distribution-import": "error",
            "theme-tools/no-installed-dir-as-consumer-root": "error",
        },
    };
    return [...typed, boundaries];
}
//# sourceMappingURL=typed-eslint-config.js.map