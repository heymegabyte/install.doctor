import { noDynamicShellCommandRule } from "./no-dynamic-shell-command.js";
import { noInstalledDirAsConsumerRoot } from "./no-installed-dir-as-consumer-root.js";
import { noUnvalidatedExternalBoundaryRule } from "./no-unvalidated-external-boundary.js";
import { noPrivateDistributionImport } from "./no-private-distribution-import.js";
export { noDynamicShellCommandRule, noInstalledDirAsConsumerRoot as noInstalledDirAsConsumerRootRule, noPrivateDistributionImport, noUnvalidatedExternalBoundaryRule };
export const themeToolsEslintPlugin = {
    meta: { name: "@theme.tools/eslint-plugin" },
    rules: {
        "no-dynamic-shell-command": noDynamicShellCommandRule,
        "no-unvalidated-external-boundary": noUnvalidatedExternalBoundaryRule,
        "no-private-distribution-import": noPrivateDistributionImport,
        "no-installed-dir-as-consumer-root": noInstalledDirAsConsumerRoot,
    },
};
export default themeToolsEslintPlugin;
//# sourceMappingURL=eslint-plugin.js.map